import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  CanDeactivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import {
  EMPTY,
  catchError,
  debounceTime,
  filter,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { WorldDetail, WorldNudge, StaleNudge } from '@hexly/domain';
import { WorldsClient } from './worlds.client';
import { NudgeBusClient } from './nudge-bus.client';
import { WORLD_NUDGE_DEBOUNCE_MS } from './world.store';
import { isAccessLoss } from '../utils/http-errors';
import { Logger } from './logger';
import { ToasterService } from './toaster.service';
import { healWorldSegment, idFromSegment } from '../utils/pretty-id';

/**
 * The active World: which World the shell and routed pages act within, plus its
 * loaded {@link WorldDetail}. Which World is active is a URL fact — the
 * `:worldId` path segment is the source of truth — but the detail is fetched and
 * pinned here by {@link activeWorldGuard} so consumers read one loaded value
 * instead of each re-fetching. Both are `null` on the World Index (`/`).
 */
@Injectable({ providedIn: 'root' })
export class ActiveWorld {
  private readonly worlds = inject(WorldsClient);
  private readonly bus = inject(NudgeBusClient);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly logger = inject(Logger);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _world = signal<WorldDetail | null>(null);
  private readonly _worldId = signal<string | null>(null);

  readonly world = this._world.asReadonly();
  /** The active World id — pinned even when the detail failed to load. */
  readonly worldId = this._worldId.asReadonly();
  readonly name = computed(() => this._world()?.name ?? null);

  constructor() {
    // Live-follow the active World (ADR-0044, #176/#178). Two outcomes ride the one follow:
    // - `unavailable` (membership loss, World deleted) → *evict*: blank the World and send the
    //   viewer to the Index rather than leave an open Dashboard they can't enter.
    // - a readable nudge (rename, pin reorder, metadata) → *refetch* the authoritative detail and
    //   re-pin it, so an open Dashboard — which derives its name and pins from world() — reflects
    //   the change without a reload. Debounced to coalesce a burst; `newerThanHeld` drops a
    //   self-echo (this tab's own commitPins already re-pinned) so it doesn't refetch its own write.
    toObservable(this._worldId)
      .pipe(
        switchMap((id) =>
          id === null
            ? EMPTY
            : this.bus.follow({ kind: 'world', id }).pipe(
                tap((n) => {
                  if ('unavailable' in n) this.evict();
                }),
                filter((n): n is WorldNudge | StaleNudge => !('unavailable' in n)),
                // Refetch-worthy up front, then debounce.
                filter((n) => this.wantsRefetch(n)),
                debounceTime(WORLD_NUDGE_DEBOUNCE_MS),
                // Re-check after the debounce: this tab's own commitPins may have landed during the
                // window, advancing the held detail past the nudge — then there's nothing to refetch.
                filter((n) => this.wantsRefetch(n)),
                switchMap(() =>
                  this.worlds.get(id).pipe(
                    catchError((err) => {
                      // A 403/404 is access *gone* (lost while disconnected, no eviction nudge to
                      // replay): evict as the reconnect refetch surfaces the loss (#177). A transient
                      // failure leaves the held detail as-is (self-heals on the next nudge/reconnect);
                      // log it — mirroring WorldStore — so a stale Dashboard isn't silently unexplained.
                      if (isAccessLoss(err)) this.evict();
                      else this.logger.error('Failed to refetch the active World from a nudge', err);
                      return EMPTY;
                    }),
                  ),
                ),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      // Only apply a refetch at least as fresh as the held detail. The nudge-driven GET and this
      // tab's own commitPins are independent subscriptions with no response ordering: a stale GET
      // (one that read server state before commitPins committed) resolving late must not revert a
      // newer local write back to old pins. A null resolve (World just went unreachable) leaves
      // the held detail alone — the `unavailable` path owns eviction.
      .subscribe((detail) => {
        const held = this._world();
        if (detail && (!held || detail.updatedAt >= held.updatedAt)) this.set(detail);
      });
  }

  /**
   * Whether a readable World nudge is newer than the loaded detail — the self-echo guard. A World
   * has no `version`, so `updatedAt` is the sole freshness key (a rename/pin/metadata patch bumps
   * it). No held detail (an id-only pin from a failed fetch) → always refetch, to recover it.
   */
  private newerThanHeld(n: WorldNudge): boolean {
    const held = this._world();
    return !held || n.updatedAt > held.updatedAt;
  }

  /**
   * Whether a follow signal should drive a refetch: a `stale` reconnect pulse always does (no
   * updatedAt to compare — the `||` order matters), else only a nudge newer than held (#177). One
   * predicate for both the pre- and post-debounce gates so they can't drift.
   */
  private wantsRefetch(n: WorldNudge | StaleNudge): boolean {
    return 'stale' in n || this.newerThanHeld(n);
  }

  /** Blank the active World and return to the World Index — the eviction landing. */
  private evict(): void {
    this._world.set(null);
    this._worldId.set(null);
    this.router.navigate(['/']);
  }

  /**
   * Pin the active World. Pass the loaded {@link WorldDetail}, an id string to pin
   * the id alone (detail unknown — e.g. a failed fetch), or `null` to clear.
   */
  set(world: WorldDetail | string | null, worldId?: string | null): void {
    const detail = typeof world === 'string' ? null : world;
    this._world.set(detail);
    const _worldId =
      worldId ?? (typeof world === 'string' ? world : (detail?.id ?? null));
    if (_worldId !== this._worldId()) {
      this._worldId.set(_worldId);
    }
  }

  /**
   * Persist the active World's pin set wholesale and re-pin from the returned
   * Detail. Owner-only server-side; a failure toasts and leaves the pins as they
   * were. The single home for every pin-mutating surface, so all share one error UX.
   */
  commitPins(pinnedEntityIds: string[]): void {
    const worldId = this._worldId();
    if (!worldId) return;
    this.worlds.setPins(worldId, pinnedEntityIds).subscribe({
      next: (detail) => this.set(detail),
      error: () =>
        this.toaster.show(
          this.transloco.translate('worldDashboard.pinError'),
          'error',
        ),
    });
  }
}

/**
 * Pins {@link ActiveWorld} from the `:worldId` segment and self-heals its
 * decorative slug. It decodes the id, fetches the World detail (reusing an
 * already-pinned one so the heal redirect never re-fetches), and pins it. With the
 * name in hand it rewrites a bare, stale, or legacy World segment to the canonical
 * `slug-base62` form via a `replaceUrl` redirect that preserves the child path and
 * query — the base62 suffix stays the sole authority, so an un-healed URL still
 * resolves. A failed fetch pins the id alone and lets the page render its own error.
 */
export const activeWorldGuard: CanActivateFn = (route, state) => {
  const worldId = idFromSegment(route.paramMap.get('worldId') ?? '');
  const active = inject(ActiveWorld);
  const router = inject(Router);

  const proceed = (world: WorldDetail | null) => {
    active.set(world, worldId);
    if (!world) return true;
    const healed = healWorldSegment(state.url, worldId, world.name);
    return healed ? router.parseUrl(healed) : true;
  };

  if (active.worldId() === worldId && active.world()) {
    return proceed(active.world());
  }
  return inject(WorldsClient)
    .get(worldId)
    .pipe(
      map((world) => proceed(world)),
      catchError(() => of(proceed(null))),
    );
};

/** The World id the router state resolves to, or `null` when it isn't World-scoped. */
function targetWorldId(state: RouterStateSnapshot): string | null {
  for (let r: ActivatedRouteSnapshot | null = state.root; r; r = r.firstChild) {
    const seg = r.paramMap.get('worldId');
    if (seg) return idFromSegment(seg);
  }
  return null;
}

/**
 * Clears {@link ActiveWorld} when leaving the World scope, on the `w/:worldId`
 * parent's `canDeactivate`. Only clears when the destination truly leaves this
 * World: the slug self-heal bounces through a `replaceUrl` redirect that
 * deactivates this parent, and clearing on it would blank the World-scoped rail
 * for a frame. The decoded id is the identity, not the segment string, so a
 * uuid↔slug hop reads as "same World" and the scope stays pinned.
 */
export const clearActiveWorld: CanDeactivateFn<unknown> = (_c, _r, _s, nextState) => {
  const active = inject(ActiveWorld);
  if (targetWorldId(nextState) !== active.worldId()) {
    active.set(null);
  }
  return true;
};
