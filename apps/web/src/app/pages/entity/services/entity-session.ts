import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  map,
  Observable,
  switchMap,
  tap,
} from 'rxjs';
import {
  Content,
  emptyHexMap,
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  HexMap,
  hexMapSchema,
  tiptapContent,
} from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { TitleService } from '../../../core/i18n/title.service';
import { AppShellStore } from '../../../shell/app-shell.store';
import { EntityView, HexMapStore } from './hexmap-store';

/**
 * Bridges {@link EntitiesClient} and {@link HexMapStore} for `/entities/:id`:
 * unwraps the stored grid on open, re-wraps it (ADR-0019) on save.
 *
 * Route-scoped (`providers`), not root: leaving the route destroys it, so
 * open-Entity state resets implicitly.
 */
@Injectable()
export class EntitySession {
  private readonly entities = inject(EntitiesClient);
  private readonly editor = inject(HexMapStore);
  private readonly title = inject(TitleService);
  private readonly router = inject(Router);
  private readonly shell = inject(AppShellStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _current = signal<EntityDetail | null>(null);
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this._conflict.asReadonly();

  /** Fires on load, conflict reload, note swap — NOT clean saves/renames, so in-flight keystrokes aren't discarded. */
  private readonly _seed = signal<EntityDetail | null>(null);
  readonly seed = this._seed.asReadonly();

  private readonly _error = signal<'save' | 'reload' | null>(null);
  readonly error = this._error.asReadonly();

  /** Live Content envelope (ADR-0019); here not in {@link HexMapStore} since Content spans every Entity type. */
  private readonly _content = signal<Content | null>(null);
  /**
   * Live Content for an editor to seed from on (re)mount. Unlike {@link seed} it
   * carries edits since load, so an editor recreated mid-session (Map↔Note toggle,
   * #75) restores the latest prose, not the loaded snapshot.
   */
  readonly content = this._content.asReadonly();

  /**
   * Live Tags (#72): span every Entity type and ride the version-checked save, so a
   * body-only save never silently drops them. Survives a clean save.
   */
  private readonly _tags = signal<readonly string[]>([]);
  readonly tags = this._tags.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /**
   * Route load in flight. `current` still holds the previous Entity until the new
   * one resolves, so writes are blocked — a header can't rename/save onto the
   * Entity the user just navigated away from.
   */
  private readonly _loading = signal(false);

  constructor() {
    // One owner for the tab title across every view this route dispatches to.
    effect(() => this.title.setDocumentName(this._current()?.name ?? null));
    this.destroyRef.onDestroy(() => this.title.setDocumentName(null));
  }

  /**
   * Caller passes its ActivatedRoute in — a route-scoped service would get the root
   * injector's route. switchMap keeps a stale A response off B's canvas; 404 → library.
   */
  watchRoute(route: ActivatedRoute): void {
    route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
        switchMap((id) =>
          this.openRoute(id).pipe(
            catchError(() => {
              this.router.navigateByUrl('/entities');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // Editor surface lives in the URL (#75): refresh/shared link restores the view,
    // opening another Entity (no `view` param) resets to the grid.
    route.queryParamMap
      .pipe(
        map((q): EntityView => (q.get('view') === 'note' ? 'note' : 'map')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((view) => this.editor.setView(view));
  }

  open(id: string): Observable<EntityDetail> {
    return this.entities.load(id).pipe(tap((detail) => this.adopt(detail)));
  }

  adopt(detail: EntityDetail): void {
    this._conflict.set(null);
    this._error.set(null);
    this._current.set(detail);
    this._content.set(detail.document.content); // before seed: seed effect reads content()
    this._seed.set(detail);
    this._tags.set(detail.tags);
    this.editor.load(gridOf(detail.document));
  }

  /** Wrap the editor's latest snapshot in the format envelope (ADR-0019). */
  setContent(snapshot: unknown): void {
    this._content.set(tiptapContent(snapshot));
  }

  /** Replace the live tags (#72); the next save persists them version-checked. */
  setTags(tags: readonly string[]): void {
    this._tags.set(tags);
  }

  /** Always a fresh fetch: the session outlives library trips, so a cached `current` can be stale (#70). */
  openRoute(id: string): Observable<EntityDetail> {
    this.editor.load(emptyHexMap()); // clear the previous canvas during load (#7)
    this._tags.set([]); // and the previous Entity's tags/content, which ride the same load (#88)
    this._content.set(null);
    this._loading.set(true);
    return this.open(id).pipe(
      this.shell.withLoading('subtle'),
      finalize(() => this._loading.set(false)),
    );
  }

  /** Rename the open Entity (metadata only — does not affect the body save). */
  rename(name: string): Observable<EntityDetail> {
    // None open, or one loading under navigation → no-op (not a throw), so a stale
    // rename can't write to the Entity the user navigated away from (#4).
    const open = this._current();
    if (!open || this._loading()) return EMPTY;
    return this.entities.rename(open.id, name).pipe(
      tap((updated) => {
        this._current.set(updated);
        this._conflict.set(null); // fresh state clears any stale 409 chip
      }),
    );
  }

  /** Save the editor's live grid under the open Entity's base version. */
  save(): Observable<EntitySaveOutcome> {
    // None open, or one loading under navigation → no-op: avoids sticking `_saving`
    // on "Saving…" or writing to the wrong Entity (#4).
    const open = this._current();
    if (!open || this._loading()) return EMPTY;
    this._saving.set(true);
    this._error.set(null);
    const body = withContent(
      withGrid(open.document, this.editor.document()),
      this._content()!,
    );
    return this.entities.save(open.id, body, open.version, this._tags()).pipe(
      tap((outcome) => {
        // On conflict, leave the open Entity untouched so the edit survives until
        // a re-pull; only a clean save advances it.
        if (outcome.status === 'conflict') {
          this._conflict.set(outcome.current);
        } else {
          this._conflict.set(null);
          this._current.set(outcome.entity);
        }
      }),
      catchError(() => {
        this._error.set('save');
        return EMPTY;
      }),
      this.shell.withLoading('subtle'),
      finalize(() => this._saving.set(false)),
    );
  }

  /** Conflict resolution (#6): accept the server's version, discarding the rejected local edit. */
  reload(): Observable<EntityDetail> {
    // Real GET via `open()` — the conflict re-pull must not be cached (#4).
    const open = this._current();
    if (!open) return EMPTY;
    this._error.set(null);
    return this.open(open.id).pipe(
      catchError(() => {
        this._error.set('reload');
        return EMPTY;
      }),
    );
  }
}

/** Parse through {@link hexMapSchema} so the schema drops `type`/`content`, not a hand-listed field set; empty for notes. */
function gridOf(body: EntityBody): HexMap {
  return body.type === 'hexmap' ? hexMapSchema.parse(body) : emptyHexMap();
}

/**
 * Re-wrap an edited grid into the body, carrying Content and type through (ADR-0019).
 * Non-hexmap bodies pass through as-is, so the hex seam can't coerce a note on save.
 */
function withGrid(body: EntityBody, grid: HexMap): EntityBody {
  return body.type === 'hexmap' ? { ...body, ...grid } : body;
}

/** Fold the live Content into the body on save (ADR-0019); spread preserves the type discriminant. */
function withContent(body: EntityBody, content: Content): EntityBody {
  return { ...body, content };
}
