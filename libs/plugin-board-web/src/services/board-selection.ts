import { computed, signal, Signal } from '@angular/core';
import { BoardElement, BoardSurface } from '@hexly/plugin-board';

/**
 * How a Select gesture folds into the Selection set (mirrors the Hex Map's Pick, ADR-0017):
 *
 * - `replace` — plain click: the set becomes exactly the clicked element.
 * - `toggle` — Cmd/Ctrl-click: drop the element if present, add it if absent.
 * - `add` — Shift-click / sweep: add the element, never removing (re-entering leaves it put).
 */
export type SelectMode = 'replace' | 'toggle' | 'add';

/**
 * The Board's transient Selection: a set of Board Element ids over the live surface (CONTEXT.md →
 * Selection, #267). Neither undone nor persisted itself — it is UI state, never written to the surface
 * document — though the store's history snapshots and restores it in lockstep with the document
 * ({@link snapshot}/{@link restore}), so an undo brings the selection back with the elements it framed.
 * The free-positioned twin of `MapSelection`, minus the coordinate stack and click-cycle a hex plane
 * needs: a Board Element is picked by its own id, so there is nothing to descend.
 *
 * Read-only on the document `Signal`: this module never mutates the surface.
 */
export class BoardSelection {
  constructor(private readonly doc: Signal<BoardSurface>) {}

  /** The selected element ids, in selection order; {@link selectedIds} resolves them against the doc. */
  private readonly _ids = signal<readonly string[]>([]);

  /**
   * The selected ids resolved against the live surface: an id whose element is gone (deleted, or
   * dropped by an undo) resolves away, so the selection can never point at an element that no longer
   * exists.
   */
  readonly selectedIds = computed<readonly string[]>(() => {
    const present = new Set(this.doc().elements.map((e) => e.id));
    return this._ids().filter((id) => present.has(id));
  });

  /** The selected elements, in selection order — a narrow view the Inspector and canvas read. */
  readonly selectedElements = computed<BoardElement[]>(() => {
    const byId = new Map(this.doc().elements.map((e) => [e.id, e]));
    return this.selectedIds().flatMap((id) => {
      const element = byId.get(id);
      return element ? [element] : [];
    });
  });

  /** The single selected element, or `null` when zero or many are selected. */
  readonly selectedElement = computed<BoardElement | null>(() => {
    const all = this.selectedElements();
    return all.length === 1 ? all[0] : null;
  });

  /** Whether `id` is in the selection set (resolved against the live surface). */
  has(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  /**
   * Select element `id` per `mode`: `replace` makes the set exactly `{id}`, `toggle` flips it in or
   * out, `add` includes it without ever removing. Returns nothing — callers read {@link selectedIds}.
   */
  select(id: string, mode: SelectMode = 'replace'): void {
    switch (mode) {
      case 'replace':
        this._ids.set([id]);
        break;
      case 'toggle': {
        const current = this._ids();
        this._ids.set(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
        break;
      }
      case 'add':
        if (!this._ids().includes(id)) this._ids.set([...this._ids(), id]);
        break;
    }
  }

  /**
   * Replace the whole set with `ids` (`additive` false), or add the missing ones (`additive` true) —
   * the marquee/programmatic path. Duplicates are dropped, order preserved.
   */
  selectMany(ids: readonly string[], additive = false): void {
    const base = additive ? this._ids() : [];
    const seen = new Set(base);
    const merged = [...base];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    this._ids.set(merged);
  }

  /** Clear the selection — the one canonical clear (Escape, teardown, a click on empty surface). */
  deselect(): void {
    this._ids.set([]);
  }

  /** Drop every selected id matching `match`, leaving the rest. */
  dropWhere(match: (id: string) => boolean): void {
    const remaining = this._ids().filter((id) => !match(id));
    if (remaining.length !== this._ids().length) this._ids.set(remaining);
  }

  /** The current id set, for the store's undo/redo history to snapshot as an edit's before/after. */
  snapshot(): readonly string[] {
    return this._ids();
  }

  /** Restore a snapshotted id set ({@link snapshot}) — the store replays it alongside a document undo/redo. */
  restore(ids: readonly string[]): void {
    this._ids.set(ids);
  }
}
