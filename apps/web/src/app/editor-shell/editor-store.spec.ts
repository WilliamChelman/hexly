import { emptyHexMap } from '@hexly/domain';
import { EditorStore } from './editor-store';

describe('EditorStore', () => {
  it('paints a Hex with the given terrain at the given coordinate', () => {
    const store = new EditorStore();

    store.paintAt({ q: 1, r: -2 }, 'ocean');

    expect(store.document().hexes['1,-2']).toEqual({ terrain: 'ocean' });
  });

  it('replaces the terrain when painting an already-painted hex', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');

    store.paintAt({ q: 0, r: 0 }, 'desert');

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'desert' });
  });

  it('does not mutate the previous document when painting (goes through Immer)', () => {
    const store = new EditorStore();
    const before = store.document();

    store.paintAt({ q: 0, r: 0 }, 'grass');

    expect(store.document()).not.toBe(before);
    expect(before.hexes).toEqual({});
  });

  it('erases a hex by deleting its record entirely, not blanking it', () => {
    const store = new EditorStore();
    store.paintAt({ q: 2, r: 2 }, 'grass');

    store.eraseAt({ q: 2, r: 2 });

    expect('2,2' in store.document().hexes).toBe(false);
  });

  it('undo removes a painted hex', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    store.undo();

    expect('0,0' in store.document().hexes).toBe(false);
  });

  it('redo re-applies an undone paint', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'mountain');
    store.undo();

    store.redo();

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'mountain' });
  });

  it('undo restores a hex that was erased', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.eraseAt({ q: 0, r: 0 });

    store.undo();

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'grass' });
  });

  it('drops the redo stack once a new edit is made', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.undo();

    store.paintAt({ q: 1, r: 1 }, 'grass'); // a fresh edit invalidates the redo branch
    store.redo();

    expect('0,0' in store.document().hexes).toBe(false);
    expect('1,1' in store.document().hexes).toBe(true);
  });

  it('reports nothing to undo or redo on a fresh map, and ignores both', () => {
    const store = new EditorStore();

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(() => {
      store.undo();
      store.redo();
    }).not.toThrow();
    expect(store.document().hexes).toEqual({});
  });

  it('tracks whether undo and redo are available as edits flow', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);

    store.undo();

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it('treats erasing a Void hex as a no-op with no undo step', () => {
    const store = new EditorStore();

    store.eraseAt({ q: 5, r: 5 });

    expect(store.canUndo()).toBe(false);
  });

  it('keeps the redo branch when an edit changes nothing', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.undo();

    store.eraseAt({ q: 9, r: 9 }); // no-op: must not discard the redo branch

    expect(store.canRedo()).toBe(true);
  });

  it('applyAt paints the armed terrain', () => {
    const store = new EditorStore();
    store.selectTool({ kind: 'terrain', id: 'ocean' });

    store.applyAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'ocean' });
  });

  it('applyAt erases once the eraser is armed', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'ocean');

    store.selectTool({ kind: 'erase' });
    store.applyAt({ q: 0, r: 0 });

    expect('0,0' in store.document().hexes).toBe(false);
  });

  it('applyAt places the armed feature on the hex', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    store.selectTool({ kind: 'feature', id: 'ruin' });
    store.applyAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0'].feature).toEqual({ ref: 'ruin' });
  });

  it('applyAt clears the feature once the clear-feature tool is armed', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.placeFeatureAt({ q: 0, r: 0 }, 'ruin');

    store.selectTool({ kind: 'clear-feature' });
    store.applyAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'grass' });
  });

  it('places a feature on an already-painted hex, keeping its terrain', () => {
    const store = new EditorStore();
    store.paintAt({ q: 1, r: 1 }, 'forest');

    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');

    expect(store.document().hexes['1,1']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
    });
  });

  it('replaces the feature when placing on a hex that already has one', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');

    store.placeFeatureAt({ q: 0, r: 0 }, 'ruin');

    expect(store.document().hexes['0,0'].feature).toEqual({ ref: 'ruin' });
  });

  it('ignores placing a feature on Void — a feature rides on an existing hex', () => {
    const store = new EditorStore();

    store.placeFeatureAt({ q: 4, r: 4 }, 'settlement');

    expect('4,4' in store.document().hexes).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('keeps an existing feature when its hex is repainted with new terrain', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');

    store.paintAt({ q: 0, r: 0 }, 'grass'); // a terrain stroke must not wipe the feature

    expect(store.document().hexes['0,0']).toEqual({
      terrain: 'grass',
      feature: { ref: 'settlement' },
    });
  });

  it('clears a hex feature without disturbing its terrain', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');

    store.clearFeatureAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
  });

  it('undo reverses placing a feature, leaving the bare terrain', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');

    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.undo();

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
  });

  it('undo restores a feature that was cleared', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');

    store.clearFeatureAt({ q: 0, r: 0 });
    store.undo();

    expect(store.document().hexes['0,0'].feature).toEqual({ ref: 'settlement' });
  });

  it('loads a document, replacing whatever was being edited', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    store.load({ hexes: { '2,3': { terrain: 'ocean' } } });

    expect(store.document()).toEqual({ hexes: { '2,3': { terrain: 'ocean' } } });
  });

  it('clears undo/redo history when a document is loaded', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.undo(); // there is now a redo to make

    store.load(emptyHexMap());

    // A loaded map is a fresh starting point — you cannot undo into the old one.
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });
});
