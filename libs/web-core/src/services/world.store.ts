import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  debounceTime,
  switchMap,
  tap,
} from 'rxjs';
import {
  FollowSignal,
  WorldDetail,
  WorldMember,
  WorldSummary,
} from '@hexly/domain';
import { AuthClient } from './auth.client';
import { WorldsClient, WORLD_NUDGE_DEBOUNCE_MS } from './worlds.client';
import { Logger } from './logger';

/**
 * The caller's loaded Worlds. Which World is *active* is a URL fact
 * ({@link ActiveWorld}), not held here — this is just the loaded list plus the
 * create plumbing; the caller navigates into a created World by URL.
 */
@Injectable({ providedIn: 'root' })
export class WorldStore {
  private readonly client = inject(WorldsClient);
  private readonly auth = inject(AuthClient);
  private readonly logger = inject(Logger);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _worlds = signal<readonly WorldSummary[]>([]);
  private readonly _loaded = signal(false);
  private readonly _loadError = signal(false);
  private hasLoaded = false;

  readonly worlds = this._worlds.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  // The authenticated user's *identity*, not the mirror object: refresh() re-mirrors
  // the same user as a fresh object on every navigation, and that must not be read as
  // a user change (it would wipe the loaded list out from under the switcher).
  private readonly userId = computed(() => this.auth.currentUser()?.id ?? null);

  /**
   * A primitive key for the held World id set, so {@link toObservable} only re-follows when the
   * *membership* of the list changes (a rename keeps the same ids → same key → no re-subscribe),
   * not on every list read. Newline-joined: ids are uuids, never containing one.
   */
  private readonly followKey = computed(() =>
    this._worlds()
      .map((w) => w.id)
      .join('\n'),
  );

  /** Readable world nudges, debounced into one authoritative list refetch (see the reconciler). */
  private readonly readableNudges = new Subject<void>();

  constructor() {
    // Reset the store whenever the authenticated user changes — prevents cross-session
    // data leaks (logout → re-login on the same tab shows the new user's Worlds).
    effect(() => {
      this.userId();
      untracked(() => {
        this.hasLoaded = false;
        this._loaded.set(false);
        this._loadError.set(false);
        this._worlds.set([]);
      });
    });

    // Live-follow the reachable Worlds (ADR-0044, #176) for *cross-tab* freshness and eviction —
    // the acting tab reflects its own confirmed create/rename/delete optimistically (below), the
    // nudge covers changes made elsewhere. `switchMap` off the id-set follows every held World;
    // membership changes re-point the subscription without manual add/remove bookkeeping.
    toObservable(this.followKey)
      .pipe(
        switchMap((key) => {
          const ids = key ? key.split('\n') : [];
          return ids.length === 0 ? EMPTY : this.client.watchAll(ids);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((n) => this.reconcile(n));

    // Coalesce a burst of nudges into one refetch. `switchMap` so a newer trigger cancels an
    // in-flight `list()` — a stale response can't clobber (or resurrect an evicted World). The
    // whole pipe is torn down by takeUntilDestroyed, so no timer survives destroy.
    this.readableNudges
      .pipe(
        debounceTime(WORLD_NUDGE_DEBOUNCE_MS),
        switchMap(() =>
          this.client.list().pipe(
            // Keep the last-good list on a transient failure; log so it isn't silently lost.
            catchError((err) => {
              this.logger.error('Failed to reconcile the worlds list from a nudge', err);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((worlds) => this._worlds.set(worlds));
  }

  /**
   * Reconcile one world nudge from *another* tab. `unavailable` (membership loss, delete) → drop
   * that World at once — access has ended, no refetch needed. A readable nudge (rename, pin reorder,
   * a still-reachable membership change) → a debounced, `switchMap`-guarded authoritative refetch.
   */
  private reconcile(n: FollowSignal): void {
    if ('unavailable' in n) {
      this._worlds.update((ws) => ws.filter((w) => w.id !== n.id));
      return;
    }
    // A readable nudge OR a `stale` reconnect pulse (#177): both refetch the authoritative list.
    this.readableNudges.next();
  }

  /**
   * Fetch the caller's Worlds. Sets {@link loaded} on both success and error so the
   * World Index can surface its resolved state (list or empty) even when the call
   * fails; an error resets the guard so a later load() retries.
   */
  load(): void {
    if (this.hasLoaded) return;
    this.hasLoaded = true;
    this.client.list().subscribe({
      next: (worlds) => {
        this._worlds.set(worlds);
        this._loaded.set(true);
      },
      error: () => {
        this.hasLoaded = false;
        this._loadError.set(true);
        this._loaded.set(true);
      },
    });
  }

  // Server mints an empty World; append the *authoritative* create response so it shows (and gets
  // followed) at once — connection-independent, unlike a follow-up refetch that could fail. Create
  // itself emits no nudge (this tab didn't yet follow a World that didn't exist); cross-tab
  // discovery of a new World rides the World Index's focus-refetch, not the bus.
  create(name: string): Observable<WorldDetail> {
    return this.client.create(name).pipe(
      tap((world) => this._worlds.update((ws) => [...ws, world])),
    );
  }

  // Owner-only server-side. Reflect the acting tab's own confirmed rename immediately (not a guess
  // — the server returned it); *other* tabs following this World reconcile via its readable nudge.
  rename(id: string, name: string): Observable<WorldDetail> {
    return this.client.rename(id, name).pipe(
      tap((world) =>
        this._worlds.update((ws) =>
          ws.map((w) => (w.id === id ? { ...w, name: world.name } : w)),
        ),
      ),
    );
  }

  // Owner-only server-side, cascades its Entities. Remove it here on the acting tab's confirmed
  // delete; other tabs following this World are evicted by its `unavailable` nudge.
  delete(id: string): Observable<void> {
    return this.client.delete(id).pipe(
      tap(() => this._worlds.update((ws) => ws.filter((w) => w.id !== id))),
    );
  }

  /**
   * Leave a World: drop the caller's own membership row, then re-fetch the
   * authoritative list. Not an optimistic remove — reachability is derived, so a
   * member who still owns an Entity in the World keeps it, and only the server
   * can say which Worlds survive leaving.
   */
  leave(id: string): Observable<WorldMember[]> {
    return this.client.removeMember(id, this.userId() ?? '').pipe(
      tap(() => this.refresh()),
    );
  }

  // Re-fetch the reachable Worlds after an out-of-band change (leaving one, the
  // World Index returning to focus). Unconditional, unlike load(): it bypasses the
  // once-only guard so a re-focus reflects a World created/renamed/deleted elsewhere.
  refresh(): void {
    this.client.list().subscribe({
      next: (worlds) => this._worlds.set(worlds),
      // Keep the last-good list on a transient failure (expired session / network blip
      // while the tab was hidden) — no toast — but log it so it isn't silently lost.
      error: (err) => this.logger.error('Failed to refresh the worlds list', err),
    });
  }
}
