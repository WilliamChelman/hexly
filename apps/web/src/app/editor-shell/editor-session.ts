import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, finalize, Observable, of, tap } from 'rxjs';
import { emptyHexMap, MapDetail, MapSaveOutcome } from '@hexly/domain';
import { MapsStore } from '../maps/maps.store';
import { EditorStore } from './editor-store';

/**
 * Bridges persistence ({@link MapsStore}) and live editing ({@link EditorStore})
 * for the editor (issue #6). It is the one place that knows both halves: opening
 * pulls a stored map and hands its document to the editor; saving pushes the
 * editor's document back under the open map's base version. Components and the
 * route talk to this, not to the two stores directly, so the open/save/conflict
 * flow lives in a single, testable seam.
 */
@Injectable({ providedIn: 'root' })
export class EditorSession {
  private readonly maps = inject(MapsStore);
  private readonly editor = inject(EditorStore);

  /** The open map's metadata (title, version), or `null` before one is opened. */
  readonly current = this.maps.current;
  /** The server's current map when a save was rejected as stale, else `null`. */
  readonly conflict = this.maps.conflict;

  private readonly _saving = signal(false);
  /** Whether a save is in flight — drives the Save button's busy state. */
  readonly saving = this._saving.asReadonly();

  /** Open a stored map by id and load its document into the editor. */
  open(id: string): Observable<MapDetail> {
    return this.maps
      .load(id)
      .pipe(tap((detail) => this.editor.load(detail.document)));
  }

  /**
   * Open the map the route points at. If that map is already the open one (e.g.
   * just created, or navigating back to it) adopt it without another round trip;
   * otherwise clear the editor so a stale canvas isn't shown while the load runs,
   * then fetch it.
   */
  openRoute(id: string): Observable<MapDetail> {
    const current = this.maps.current();
    if (current?.id === id) {
      // Already open (#10): reuse it — no redundant GET. The create→navigate
      // flow lands here, since MapsStore.create already set the open map.
      this.editor.load(current.document);
      return of(current);
    }
    this.editor.load(emptyHexMap()); // clear the previous map's canvas during load (#7)
    return this.open(id);
  }

  /** Rename the open map (metadata only — does not affect the document save). */
  rename(title: string): Observable<MapDetail> {
    // No map open → a safe no-op, not a throw, so a stray rename can't escape an
    // unhandled subscribe (#4).
    const open = this.maps.current();
    if (!open) return EMPTY;
    return this.maps.rename(open.id, title);
  }

  /** Save the editor's live document under the open map's base version. */
  save(): Observable<MapSaveOutcome> {
    // Guard before any side effect: with no map open, save is a no-op rather
    // than flipping `_saving` (which would never clear, sticking the button on
    // "Saving…") or letting MapsStore.requireOpen throw synchronously (#4).
    if (!this.maps.current()) return EMPTY;
    this._saving.set(true);
    return this.maps
      .save(this.editor.document())
      .pipe(finalize(() => this._saving.set(false)));
  }

  /**
   * Re-pull the open map from the server, replacing the editor's document with
   * the current stored one. This is the conflict resolution path (issue #6): the
   * user accepts the server's version, discarding the rejected local edit.
   */
  reload(): Observable<MapDetail> {
    // No map open → a safe no-op (#4). Always issues a GET via `open()` so the
    // conflict re-pull is a real round trip.
    const open = this.maps.current();
    if (!open) return EMPTY;
    return this.open(open.id);
  }
}
