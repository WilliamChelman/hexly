import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
} from '@angular/core';
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

  private readonly _current = signal<EntityDetail | null>(null);
  /** The open Entity's metadata (name, version), or `null` before one is opened. */
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this._conflict.asReadonly();

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
    inject(DestroyRef).onDestroy(() => this.title.setDocumentName(null));
  }

  /** Open a stored Entity by id and load its hex grid into the editor. */
  open(id: string): Observable<EntityDetail> {
    return this.entities.load(id).pipe(tap((detail) => this.adopt(detail)));
  }

  /** Adopt an already-fetched Entity as the open one (clearing any conflict) and load its grid. */
  adopt(detail: EntityDetail): void {
    this._conflict.set(null);
    this._current.set(detail);
    this.editor.load(gridOf(detail.document));
  }

  /**
   * Open the Entity the route points at. Reuses the current one without a round
   * trip if the id is unchanged; otherwise clears the canvas and fetches, flagging
   * {@link _loading} to block writes mid-swap.
   */
  openRoute(id: string): Observable<EntityDetail> {
    const current = this._current();
    if (current?.id === id) {
      this.editor.load(gridOf(current.document));
      return of(current);
    }
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
   * Re-pull the open Entity, replacing the editor's grid. The conflict resolution
   * path (#6): user accepts the server's version, discarding the rejected local edit.
   */
  reload(): Observable<EntityDetail> {
    // Always a real GET via `open()` — the conflict re-pull must not be cached (#4).
    const open = this._current();
    if (!open) return EMPTY;
    return this.open(open.id);
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
