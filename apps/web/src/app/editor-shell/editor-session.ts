import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, finalize, Observable, of, tap } from 'rxjs';
import {
  emptyHexMap,
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  HexMap,
} from '@hexly/domain';
import { EntitiesStore } from '../entities/entities.store';
import { EditorStore } from './editor-store';

/**
 * Bridges persistence ({@link EntitiesStore}) and live editing
 * ({@link EditorStore}) for the editor (issue #6). It is the one place that
 * knows both halves: opening pulls a stored Entity and hands its hex grid to the
 * editor; saving pushes the editor's grid back under the open Entity's base
 * version. Components and the route talk to this, not to the two stores directly,
 * so the open/save/conflict flow lives in a single, testable seam.
 *
 * The Entity body the store carries is opaque (Content plus the typed payload);
 * the hex editor only edits the grid, so this seam owns the adaptation between
 * the two — extracting the grid on open and re-wrapping it (Content preserved
 * untouched, ADR-0019) on save — keeping {@link EditorStore} on a plain HexMap.
 */
@Injectable({ providedIn: 'root' })
export class EditorSession {
  private readonly entities = inject(EntitiesStore);
  private readonly editor = inject(EditorStore);

  /** The open Entity's metadata (name, version), or `null` before one is opened. */
  readonly current = this.entities.current;
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this.entities.conflict;

  private readonly _saving = signal(false);
  /** Whether a save is in flight — drives the Save button's busy state. */
  readonly saving = this._saving.asReadonly();

  /** Open a stored Entity by id and load its hex grid into the editor. */
  open(id: string): Observable<EntityDetail> {
    return this.entities
      .load(id)
      .pipe(tap((detail) => this.editor.load(gridOf(detail.document))));
  }

  /**
   * Open the Entity the route points at. If it is already the open one (e.g.
   * just created, or navigating back to it) adopt it without another round trip;
   * otherwise clear the editor so a stale canvas isn't shown while the load runs,
   * then fetch it.
   */
  openRoute(id: string): Observable<EntityDetail> {
    const current = this.entities.current();
    if (current?.id === id) {
      // Already open (#10): reuse it — no redundant GET. The create→navigate
      // flow lands here, since EntitiesStore.create already set the open Entity.
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
    const open = this.entities.current();
    if (!open) return EMPTY;
    return this.entities.rename(open.id, name);
  }

  /** Save the editor's live grid under the open Entity's base version. */
  save(): Observable<EntitySaveOutcome> {
    // Guard before any side effect: with no Entity open, save is a no-op rather
    // than flipping `_saving` (which would never clear, sticking the button on
    // "Saving…") or letting EntitiesStore.requireOpen throw synchronously (#4).
    const open = this.entities.current();
    if (!open) return EMPTY;
    this._saving.set(true);
    return this.entities
      .save(withGrid(open.document, this.editor.document()))
      .pipe(finalize(() => this._saving.set(false)));
  }

  /**
   * Re-pull the open Entity from the server, replacing the editor's grid with
   * the current stored one. This is the conflict resolution path (issue #6): the
   * user accepts the server's version, discarding the rejected local edit.
   */
  reload(): Observable<EntityDetail> {
    // No Entity open → a safe no-op (#4). Always issues a GET via `open()` so the
    // conflict re-pull is a real round trip.
    const open = this.entities.current();
    if (!open) return EMPTY;
    return this.open(open.id);
  }
}

/** Extract the hex grid the canvas edits from an Entity body (empty for a note). */
function gridOf(body: EntityBody): HexMap {
  return body.type === 'hexmap'
    ? { hexes: body.hexes, regions: body.regions, labels: body.labels }
    : emptyHexMap();
}

/**
 * Re-wrap an edited hex `grid` into a hexmap body, carrying the existing Content
 * through untouched (ADR-0019 — the editor never inspects or rewrites it). The
 * hex editor only ever opens hexmaps, so the result is always a hexmap body.
 */
function withGrid(body: EntityBody, grid: HexMap): EntityBody {
  return { type: 'hexmap', content: body.content, ...grid };
}
