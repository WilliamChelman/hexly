import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, finalize, Observable, of, tap } from 'rxjs';
import {
  emptyHexMap,
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  HexMap,
  hexMapSchema,
} from '@hexly/domain';
import { EntitiesClient } from '../entities/entities.client';
import { EditorStore } from './editor-store';

/**
 * Bridges persistence ({@link EntitiesClient}) and live editing
 * ({@link EditorStore}) for the editor (issue #6): opening pulls a stored Entity
 * and hands its grid to the editor; saving pushes the grid back under the open
 * Entity's base version. Components and the route talk to this, not the client,
 * so the open/save/conflict flow lives in one testable seam.
 *
 * It also owns the open-Entity/conflict state — the only Entity state that
 * outlives a single request — so {@link EntitiesClient} stays a stateless HTTP
 * surface. The client's body is opaque; the hex editor only edits the grid, so
 * this seam extracts the grid on open and re-wraps it (Content preserved,
 * ADR-0019) on save, keeping {@link EditorStore} on a plain HexMap.
 */
@Injectable({ providedIn: 'root' })
export class EditorSession {
  private readonly entities = inject(EntitiesClient);
  private readonly editor = inject(EditorStore);

  private readonly _current = signal<EntityDetail | null>(null);
  /** The open Entity's metadata (name, version), or `null` before one is opened. */
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this._conflict.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /** Open a stored Entity by id and load its hex grid into the editor. */
  open(id: string): Observable<EntityDetail> {
    return this.entities.load(id).pipe(tap((detail) => this.adopt(detail)));
  }

  /**
   * Adopt an already-fetched Entity as the open one (clearing any conflict) and
   * load its grid. The create→navigate flow uses this to hand the just-created
   * Entity straight to the editor, so `openRoute` can reuse it without a GET.
   */
  adopt(detail: EntityDetail): void {
    this._conflict.set(null);
    this._current.set(detail);
    this.editor.load(gridOf(detail.document));
  }

  /**
   * Open the Entity the route points at. If it is already the open one (e.g.
   * just created, or navigating back to it) reuse it without another round trip;
   * otherwise clear the editor so a stale canvas isn't shown while the load runs,
   * then fetch it.
   */
  openRoute(id: string): Observable<EntityDetail> {
    const current = this._current();
    if (current?.id === id) {
      // Already open (#10): reuse it — no redundant GET. The create→navigate
      // flow lands here, having adopted the created Entity before navigating.
      this.editor.load(gridOf(current.document));
      return of(current);
    }
    this.editor.load(emptyHexMap()); // clear the previous map's canvas during load (#7)
    return this.open(id);
  }

  /** Rename the open Entity (metadata only — does not affect the body save). */
  rename(name: string): Observable<EntityDetail> {
    // No Entity open → a safe no-op, not a throw, so a stray rename can't escape
    // an unhandled subscribe (#4).
    const open = this._current();
    if (!open) return EMPTY;
    return this.entities.rename(open.id, name).pipe(
      tap((updated) => {
        this._current.set(updated);
        this._conflict.set(null); // a fresh state clears any stale 409 chip
      }),
    );
  }

  /** Save the editor's live grid under the open Entity's base version. */
  save(): Observable<EntitySaveOutcome> {
    // Guard before any side effect: with no Entity open, save is a no-op rather
    // than flipping `_saving` (which would never clear, sticking the button on
    // "Saving…") (#4).
    const open = this._current();
    if (!open) return EMPTY;
    this._saving.set(true);
    return this.entities
      .save(open.id, withGrid(open.document, this.editor.document()), open.version)
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
        finalize(() => this._saving.set(false)),
      );
  }

  /**
   * Re-pull the open Entity from the server, replacing the editor's grid with
   * the current stored one. This is the conflict resolution path (issue #6): the
   * user accepts the server's version, discarding the rejected local edit.
   */
  reload(): Observable<EntityDetail> {
    // No Entity open → a safe no-op (#4). Always issues a GET via `open()` so the
    // conflict re-pull is a real round trip.
    const open = this._current();
    if (!open) return EMPTY;
    return this.open(open.id);
  }
}

/**
 * Extract the canvas's hex grid from an Entity body (empty for a note). Parsing
 * through {@link hexMapSchema} pulls exactly the grid fields and drops
 * `type`/`content`, tracking the schema rather than a hand-listed field set.
 */
function gridOf(body: EntityBody): HexMap {
  return body.type === 'hexmap' ? hexMapSchema.parse(body) : emptyHexMap();
}

/**
 * Re-wrap an edited `grid` into the open body, carrying Content and type through
 * untouched (ADR-0019). Only a hexmap takes the grid; any other body is returned
 * as-is, so the hex seam can't coerce a note into a blank hexmap on save.
 */
function withGrid(body: EntityBody, grid: HexMap): EntityBody {
  return body.type === 'hexmap' ? { ...body, ...grid } : body;
}
