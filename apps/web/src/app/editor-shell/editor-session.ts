import { Injectable, inject, signal } from '@angular/core';
import { finalize, Observable, tap } from 'rxjs';
import { MapDetail } from '@hexly/domain';
import { MapsStore, SaveOutcome } from '../maps/maps.store';
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

  /** Rename the open map (metadata only — does not affect the document save). */
  rename(title: string): Observable<MapDetail> {
    const open = this.maps.current();
    if (!open) throw new Error('No map is open');
    return this.maps.rename(open.id, title);
  }

  /** Save the editor's live document under the open map's base version. */
  save(): Observable<SaveOutcome> {
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
    const open = this.maps.current();
    if (!open) throw new Error('No map is open');
    return this.open(open.id);
  }
}
