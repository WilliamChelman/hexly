import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
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
import { EntitiesClient } from '../entities/entities.client';
import { TitleService } from '../core/i18n/title.service';
import { EditorStore } from './editor-store';

/**
 * Bridges persistence ({@link EntitiesClient}) and live editing ({@link EditorStore})
 * for the open-Entity route: opening pulls a stored Entity and hands its grid to the
 * editor; saving pushes it back under the open Entity's base version. Extracts the
 * grid on open and re-wraps it (ADR-0019) on save, keeping EditorStore on a plain HexMap.
 *
 * Scoped to the `/entities/:id` route (`providers`), not root: leaving the route
 * destroys it, so open-Entity state resets implicitly — no teardown needed in views.
 */
@Injectable()
export class EditorSession {
  private readonly entities = inject(EntitiesClient);
  private readonly editor = inject(EditorStore);
  private readonly title = inject(TitleService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _current = signal<EntityDetail | null>(null);
  /** The open Entity's metadata (name, version), or `null` before one is opened. */
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this._conflict.asReadonly();

  /**
   * Fires only when the editor should re-seed from the server's authoritative
   * snapshot: initial load, conflict reload, and note swap. Does NOT fire on clean
   * saves or renames, so neither advances the editor past in-flight keystrokes.
   */
  private readonly _seed = signal<EntityDetail | null>(null);
  readonly seed = this._seed.asReadonly();

  /** Non-null when the last save or reload HTTP request failed. */
  private readonly _error = signal<'save' | 'reload' | null>(null);
  readonly error = this._error.asReadonly();

  /**
   * The open Entity's live, opaque Content envelope (ADR-0019) — seeded from the
   * loaded body and replaced as the content editor produces snapshots. Held here,
   * not in {@link EditorStore} (which is the hex grid's command/undo stack), because
   * Content is the editing surface for every Entity type, `note` foremost. `null`
   * before one is opened. The seam never parses the snapshot inside; it just carries
   * it from load to save.
   */
  private readonly _content = signal<Content | null>(null);

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /**
   * Whether a route load is in flight. `current` still holds the previous Entity
   * until the new one resolves, so writes are blocked — a mounted header can't
   * rename/save onto the Entity the user just navigated away from.
   */
  private readonly _loading = signal(false);

  constructor() {
    // One owner for the tab title across all views this route dispatches to —
    // lives here so neither the map editor nor the note view each re-derive it.
    effect(() => this.title.setDocumentName(this._current()?.name ?? null));
    this.destroyRef.onDestroy(() => this.title.setDocumentName(null));
  }

  /**
   * Drive the open Entity from a route's `:id`. The routed component hands its
   * ActivatedRoute in (only the routed component's injector carries the one
   * bound to `:id` — a route-scoped service injecting it would get the root).
   * switchMap cancels an in-flight load on id change, so /entities/A then
   * /entities/B can't let a stale A response land over B's canvas; a failed
   * load (404) returns to the library (#3).
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
  }

  /** Open a stored Entity by id and load its hex grid into the editor. */
  open(id: string): Observable<EntityDetail> {
    return this.entities.load(id).pipe(tap((detail) => this.adopt(detail)));
  }

  /** Adopt an already-fetched Entity as the open one (clearing any conflict) and load its grid + Content. */
  adopt(detail: EntityDetail): void {
    this._conflict.set(null);
    this._error.set(null);
    this._current.set(detail);
    this._seed.set(detail);
    this._content.set(detail.document.content);
    this.editor.load(gridOf(detail.document));
  }

  /**
   * Replace the live Content with the editor's latest `snapshot` (TipTap/ProseMirror
   * JSON). Wrapped in the current format envelope here; the snapshot itself is never
   * parsed (ADR-0019), so it round-trips to {@link save} exactly as the editor left it.
   */
  setContent(snapshot: unknown): void {
    this._content.set(tiptapContent(snapshot));
  }

  /**
   * Open the Entity the route points at: clear the canvas, then fetch, flagging
   * {@link _loading} to block writes mid-swap.
   *
   * Always a fresh fetch — even when the id matches what's already open. This
   * session is route-scoped but outlives a trip back to the library (its route
   * injector isn't torn down between visits), so a retained `current` can be
   * stale — e.g. a note renamed in the browser then reopened (#70). Re-fetching
   * on entry also re-adopts, resetting the open-Entity state the way leaving the
   * route is meant to.
   */
  openRoute(id: string): Observable<EntityDetail> {
    this.editor.load(emptyHexMap()); // clear the previous map's canvas during load (#7)
    this._loading.set(true);
    return this.open(id).pipe(finalize(() => this._loading.set(false)));
  }

  /** Rename the open Entity (metadata only — does not affect the body save). */
  rename(name: string): Observable<EntityDetail> {
    // No Entity open, or one loading under navigation → safe no-op (not a throw),
    // so a stale rename can't write to the Entity the user navigated away from (#4).
    const open = this._current();
    if (!open || this._loading()) return EMPTY;
    return this.entities.rename(open.id, name).pipe(
      tap((updated) => {
        this._current.set(updated);
        this._conflict.set(null); // a fresh state clears any stale 409 chip
      }),
    );
  }

  /** Save the editor's live grid under the open Entity's base version. */
  save(): Observable<EntitySaveOutcome> {
    // No Entity open, or one loading under navigation → no-op: avoids flipping
    // `_saving` (would stick the button on "Saving…") or writing to the wrong Entity (#4).
    const open = this._current();
    if (!open || this._loading()) return EMPTY;
    this._saving.set(true);
    this._error.set(null);
    const body = withContent(
      withGrid(open.document, this.editor.document()),
      this._content()!,
    );
    return this.entities
      .save(open.id, body, open.version)
      .pipe(
        tap((outcome) => {
          // On conflict, leave the open Entity untouched so the edit isn't lost
          // before a re-pull; only a clean save advances it.
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
        finalize(() => this._saving.set(false)),
      );
  }

  /**
   * Re-pull the open Entity, replacing the editor's grid. The conflict resolution
   * path (#6): user accepts the server's version, discarding the rejected local edit.
   */
  reload(): Observable<EntityDetail> {
    // Always a real GET via `open()` — the conflict re-pull must not be cached (#4).
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

/**
 * Extract the hex grid from an Entity body (empty for a note). Parsing through
 * {@link hexMapSchema} drops `type`/`content`, tracking the schema not a hand-listed field set.
 */
function gridOf(body: EntityBody): HexMap {
  return body.type === 'hexmap' ? hexMapSchema.parse(body) : emptyHexMap();
}

/**
 * Re-wrap an edited grid into the body, carrying Content and type through (ADR-0019).
 * Non-hexmap bodies are returned as-is, so the hex seam can't coerce a note on save.
 */
function withGrid(body: EntityBody, grid: HexMap): EntityBody {
  return body.type === 'hexmap' ? { ...body, ...grid } : body;
}

/**
 * Fold the live edited Content back into the body on save (ADR-0019). Spreading
 * preserves the `type` discriminant, so a note stays a note and a hexmap keeps its
 * grid — only the opaque Content envelope is replaced.
 */
function withContent(body: EntityBody, content: Content): EntityBody {
  return { ...body, content };
}
