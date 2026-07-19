import { signal } from '@angular/core';
import { BoardElement, BoardSurface } from '@hexly/plugin-board';
import { BoardSelection } from './board-selection';

/** A minimal Box element for driving selection tests. */
function box(id: string, z = 0): BoardElement {
  return { id, kind: 'box', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, z };
}

function surfaceOf(...ids: string[]): BoardSurface {
  return { elements: ids.map((id, i) => box(id, i)) };
}

describe('BoardSelection', () => {
  it('starts empty', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b')));
    expect(sel.selectedIds()).toEqual([]);
    expect(sel.selectedElement()).toBeNull();
  });

  it('replaces the set on a plain select', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b')));
    sel.select('a');
    sel.select('b');
    expect(sel.selectedIds()).toEqual(['b']);
    expect(sel.selectedElement()?.id).toBe('b');
  });

  it('toggles an id in and out', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b')));
    sel.select('a');
    sel.select('b', 'toggle');
    expect(sel.selectedIds()).toEqual(['a', 'b']);
    sel.select('a', 'toggle');
    expect(sel.selectedIds()).toEqual(['b']);
  });

  it('adds without ever removing', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b')));
    sel.select('a', 'add');
    sel.select('a', 'add');
    sel.select('b', 'add');
    expect(sel.selectedIds()).toEqual(['a', 'b']);
  });

  it('exposes a single selected element only when exactly one is selected', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b')));
    sel.selectMany(['a', 'b']);
    expect(sel.selectedElement()).toBeNull();
    expect(sel.selectedElements().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('resolves a stale id away when its element is gone', () => {
    const doc = signal(surfaceOf('a', 'b'));
    const sel = new BoardSelection(doc);
    sel.selectMany(['a', 'b']);

    doc.set(surfaceOf('b')); // 'a' removed from the live surface
    expect(sel.selectedIds()).toEqual(['b']);
    expect(sel.selectedElement()?.id).toBe('b');
  });

  it('selectMany replaces or accumulates', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b', 'c')));
    sel.selectMany(['a']);
    sel.selectMany(['b', 'c'], true);
    expect(sel.selectedIds()).toEqual(['a', 'b', 'c']);
    sel.selectMany(['a']);
    expect(sel.selectedIds()).toEqual(['a']);
  });

  it('snapshots and restores the raw id set', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b')));
    sel.selectMany(['a', 'b']);
    const snap = sel.snapshot();
    sel.deselect();
    expect(sel.selectedIds()).toEqual([]);
    sel.restore(snap);
    expect(sel.selectedIds()).toEqual(['a', 'b']);
  });

  it('drops ids matching a predicate', () => {
    const sel = new BoardSelection(signal(surfaceOf('a', 'b', 'c')));
    sel.selectMany(['a', 'b', 'c']);
    sel.dropWhere((id) => id === 'b');
    expect(sel.selectedIds()).toEqual(['a', 'c']);
  });
});
