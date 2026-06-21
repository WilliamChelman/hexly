import { emptyHexMap } from '@hexly/domain';
import { EditorStore, isContinuousTool } from './editor-store';

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

  it('creates a region with the given name and color, returning its id', () => {
    const store = new EditorStore();

    const id = store.createRegion('Avalon', '#b08a4e');

    expect(store.document().regions).toEqual([
      { id, name: 'Avalon', color: '#b08a4e', hexes: {} },
    ]);
  });

  it('adds a hex coordinate to a region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');

    store.addHexToRegion(id, { q: 2, r: -1 });

    expect(store.document().regions[0].hexes).toEqual({ '2,-1': true });
  });

  it('lets a single coordinate belong to two regions at once (overlap)', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    const b = store.createRegion('Whisperwood', '#7c9b86');

    store.addHexToRegion(a, { q: 0, r: 0 });
    store.addHexToRegion(b, { q: 0, r: 0 });

    const [ra, rb] = store.document().regions;
    expect(ra.hexes['0,0']).toBe(true);
    expect(rb.hexes['0,0']).toBe(true);
  });

  it('removes a hex coordinate from a region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });

    store.removeHexFromRegion(id, { q: 0, r: 0 });

    expect('0,0' in store.document().regions[0].hexes).toBe(false);
  });

  it('treats adding a coordinate already in the region as a no-op', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });

    store.addHexToRegion(id, { q: 0, r: 0 }); // already a member → records nothing

    // A single undo clears the membership: the second add left no extra step.
    store.undo();
    expect(store.document().regions[0].hexes).toEqual({});
  });

  it('treats removing a coordinate not in the region as a no-op with no undo step', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');

    store.removeHexFromRegion(id, { q: 5, r: 5 }); // not a member → records nothing

    // The only undo step is the region's creation; the remove added none.
    store.undo();
    expect(store.document().regions).toEqual([]);
  });

  it('undo reverses creating a region', () => {
    const store = new EditorStore();
    store.createRegion('Avalon', '#b08a4e');

    store.undo();

    expect(store.document().regions).toEqual([]);
  });

  it('undo reverses adding a hex to a region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });

    store.undo();

    expect(store.document().regions[0].hexes).toEqual({});
  });

  it('renames a region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');

    store.renameRegion(id, 'The Kingdom of Avalon');

    expect(store.document().regions[0].name).toBe('The Kingdom of Avalon');
  });

  it('recolors a region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');

    store.recolorRegion(id, '#6f7fae');

    expect(store.document().regions[0].color).toBe('#6f7fae');
  });

  it('deletes a region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');

    store.deleteRegion(id);

    expect(store.document().regions).toEqual([]);
  });

  it('resets the armed tool to the default terrain when its region is deleted', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.selectTool({ kind: 'region', id, mode: 'add' });

    store.deleteRegion(id); // the armed region no longer exists

    expect(store.tool()).toEqual({ kind: 'terrain', id: 'forest' });
  });

  it('undo restores a deleted region with its membership', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 1, r: 1 });

    store.deleteRegion(id);
    store.undo();

    expect(store.document().regions[0].hexes).toEqual({ '1,1': true });
  });

  it('applyAt adds the hovered hex to the armed region', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');

    store.selectTool({ kind: 'region', id, mode: 'add' });
    store.applyAt({ q: 3, r: 3 });

    expect(store.document().regions[0].hexes['3,3']).toBe(true);
  });

  it('applyAt removes the hovered hex when the region tool is in remove mode', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 3, r: 3 });

    store.selectTool({ kind: 'region', id, mode: 'remove' });
    store.applyAt({ q: 3, r: 3 });

    expect('3,3' in store.document().regions[0].hexes).toBe(false);
  });

  it('keeps region membership when the underlying terrain is erased', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.addHexToRegion(id, { q: 0, r: 0 });

    store.eraseAt({ q: 0, r: 0 }); // region membership is independent of the hex

    expect(store.document().regions[0].hexes['0,0']).toBe(true);
  });

  it('adds a free-positioned label with text at a world point, returning its id', () => {
    const store = new EditorStore();

    const id = store.addLabel('The Whisperwood', { x: 120, y: -40 });

    expect(store.document().labels).toEqual([
      { id, text: 'The Whisperwood', position: { x: 120, y: -40 }, size: expect.any(Number) },
    ]);
  });

  it('undo removes an added label', () => {
    const store = new EditorStore();
    store.addLabel('Open Sea', { x: 0, y: 0 });

    store.undo();

    expect(store.document().labels).toEqual([]);
  });

  it('edits the text of a label', () => {
    const store = new EditorStore();
    const id = store.addLabel('Draft', { x: 10, y: 10 });

    store.editLabelText(id, 'The Drowned Coast');

    expect(store.document().labels[0].text).toBe('The Drowned Coast');
  });

  it('moves a label to a new world position', () => {
    const store = new EditorStore();
    const id = store.addLabel('Here', { x: 0, y: 0 });

    store.moveLabel(id, { x: 200, y: -75 });

    expect(store.document().labels[0].position).toEqual({ x: 200, y: -75 });
  });

  it('resizes a label', () => {
    const store = new EditorStore();
    const id = store.addLabel('Big', { x: 0, y: 0 });

    store.resizeLabel(id, 64);

    expect(store.document().labels[0].size).toBe(64);
  });

  it('ignores a non-positive resize, leaving the size unchanged and adding no undo step', () => {
    const store = new EditorStore();
    const id = store.addLabel('Big', { x: 0, y: 0 });
    store.resizeLabel(id, 64);

    // 0 (a cleared field is Number('') === 0) and negatives would fail
    // labelSchema.size (z.number().positive()) on save/load, so the store
    // drops them as no-ops rather than letting the document hold them.
    store.resizeLabel(id, 0);
    store.resizeLabel(id, -10);

    expect(store.document().labels[0].size).toBe(64);
    // addLabel + the valid resize are the only undo steps; the dropped resizes add none.
    expect(store.canUndo()).toBe(true);
    store.undo(); // undo the valid resize-to-64
    store.undo(); // undo the addLabel
    expect(store.canUndo()).toBe(false);
  });

  it('rotates a label', () => {
    const store = new EditorStore();
    const id = store.addLabel('Tilted', { x: 0, y: 0 });

    store.rotateLabel(id, 30);

    expect(store.document().labels[0].rotation).toBe(30);
  });

  it('deletes a label', () => {
    const store = new EditorStore();
    const id = store.addLabel('Doomed', { x: 0, y: 0 });

    store.deleteLabel(id);

    expect(store.document().labels).toEqual([]);
  });

  it('undo restores a deleted label with its text and position', () => {
    const store = new EditorStore();
    const id = store.addLabel('The Whisperwood', { x: 80, y: -20 });

    store.deleteLabel(id);
    store.undo();

    expect(store.document().labels[0]).toMatchObject({
      id,
      text: 'The Whisperwood',
      position: { x: 80, y: -20 },
    });
  });

  it('selects a label for editing, and clears the selection', () => {
    const store = new EditorStore();
    const id = store.addLabel('Pick me', { x: 0, y: 0 });

    store.selectLabel(id);
    expect(store.selectedLabel()?.id).toBe(id);

    store.selectLabel(null);
    expect(store.selectedLabel()).toBeNull();
  });

  it('clears the selection when the selected label is deleted', () => {
    const store = new EditorStore();
    const id = store.addLabel('Gone', { x: 0, y: 0 });
    store.selectLabel(id);

    store.deleteLabel(id);

    expect(store.selectedLabel()).toBeNull();
  });

  it('treats editing a label that does not exist as a no-op with no undo step', () => {
    const store = new EditorStore();

    store.editLabelText('no-such-label', 'ignored');

    expect(store.canUndo()).toBe(false);
  });

  it('loads a document, replacing whatever was being edited', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    store.load({ hexes: { '2,3': { terrain: 'ocean' } }, regions: [], labels: [] });

    expect(store.document()).toEqual({ hexes: { '2,3': { terrain: 'ocean' } }, regions: [], labels: [] });
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

describe('isContinuousTool', () => {
  it('treats terrain as a continuous brush', () => {
    expect(isContinuousTool({ kind: 'terrain', id: 'forest' })).toBe(true);
  });

  it('treats the eraser as a continuous brush', () => {
    expect(isContinuousTool({ kind: 'erase' })).toBe(true);
  });

  it('treats clear-feature as a continuous brush', () => {
    expect(isContinuousTool({ kind: 'clear-feature' })).toBe(true);
  });

  it('treats placing a feature as a discrete stamp, not continuous', () => {
    expect(isContinuousTool({ kind: 'feature', id: 'settlement' })).toBe(false);
  });

  it('treats painting a region as a continuous brush', () => {
    expect(isContinuousTool({ kind: 'region', id: 'r1', mode: 'add' })).toBe(true);
  });

  it('treats placing a label as a discrete stamp, not continuous', () => {
    expect(isContinuousTool({ kind: 'label' })).toBe(false);
  });
});
