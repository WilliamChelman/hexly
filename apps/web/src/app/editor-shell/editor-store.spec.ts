import { emptyHexMap, HexMap } from '@hexly/domain';
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

  it('applyAt does nothing when the Select tool is armed', () => {
    const store = new EditorStore();

    // A fresh map boots armed with Select; a click must paint nothing (issue #27).
    store.applyAt({ q: 0, r: 0 });

    expect(store.document().hexes).toEqual({});
    expect(store.canUndo()).toBe(false);
  });

  it('applyAt paints the armed terrain', () => {
    const store = new EditorStore();
    store.armTerrain('ocean');

    store.applyAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'ocean' });
  });

  it('applyAt erases once the eraser is armed', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'ocean');

    store.armTool('erase');
    store.applyAt({ q: 0, r: 0 });

    expect('0,0' in store.document().hexes).toBe(false);
  });

  it('applyAt places the armed feature on the hex', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    store.armFeature('ruin');
    store.applyAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0'].feature).toEqual({ ref: 'ruin' });
  });

  it('applyAt clears the feature once the Clear feature Subtool is armed', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.placeFeatureAt({ q: 0, r: 0 }, 'ruin');

    store.armFeature('clear');
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

  it('falls back to Select and forgets the Region Subtool when its region is deleted', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armRegion(id, 'add');

    store.deleteRegion(id); // the armed region no longer exists

    expect(store.tool()).toBe('select');
    expect(store.region()).toBeNull();
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

    store.armRegion(id, 'add');
    store.applyAt({ q: 3, r: 3 });

    expect(store.document().regions[0].hexes['3,3']).toBe(true);
  });

  it('applyAt removes the hovered hex when the region tool is in remove mode', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 3, r: 3 });

    store.armRegion(id, 'remove');
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

describe('EditorStore two-level armed state', () => {
  it('cold-starts armed with Select and the default Subtools', () => {
    const store = new EditorStore();

    // Select armed; Terrain → forest, Feature → first library feature, Region → none.
    expect(store.tool()).toBe('select');
    expect(store.terrain()).toBe('forest');
    expect(store.feature()).toBe('settlement');
    expect(store.region()).toBeNull();
  });

  it('arms a Tool and sets its Subtool together when a Subtool is picked', () => {
    const store = new EditorStore();

    store.armTerrain('ocean');
    expect(store.tool()).toBe('terrain');
    expect(store.terrain()).toBe('ocean');

    store.armFeature('ruin');
    expect(store.tool()).toBe('feature');
    expect(store.feature()).toBe('ruin');
  });

  it('remembers each Tool’s last Subtool and restores it on re-arm', () => {
    const store = new EditorStore();
    store.armTerrain('ocean'); // remember a non-default terrain
    store.armFeature('ruin'); // switch Tools — terrain memory must survive

    store.armTool('terrain'); // re-arm Terrain

    expect(store.tool()).toBe('terrain');
    expect(store.terrain()).toBe('ocean');
    // And the restored Subtool is what a stroke applies.
    store.applyAt({ q: 0, r: 0 });
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'ocean' });
  });

  it('keeps Subtool memory out of the document, the undo stack, and reloads', () => {
    const store = new EditorStore();

    store.armTerrain('ocean');
    store.armFeature('clear');
    store.armTool('select');

    // Subtool memory is session-only editor state (ADR-0010): arming records no
    // edit and leaves the document untouched.
    expect(store.document()).toEqual(emptyHexMap());
    expect(store.canUndo()).toBe(false);
  });

  it('picks the nth Terrain Subtool by index when Terrain is armed', () => {
    const store = new EditorStore();
    store.armTool('terrain');

    store.armSubtoolByIndex(3); // 3rd terrain in the palette is Ocean

    expect(store.terrain()).toBe('ocean');
  });

  it('picks the nth Feature Subtool by index, with Clear in the last slot', () => {
    const store = new EditorStore();
    store.armTool('feature');

    store.armSubtoolByIndex(1);
    expect(store.feature()).toBe('settlement');

    store.armSubtoolByIndex(3); // after the two library features comes Clear
    expect(store.feature()).toBe('clear');
  });

  it('picks the nth Region Subtool by index, keeping the current brush mode', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    const b = store.createRegion('Whisperwood', '#7c9b86');
    store.armRegion(a, 'remove');

    store.armSubtoolByIndex(2); // the 2nd region

    expect(store.region()).toEqual({ id: b, mode: 'remove' });
  });

  it('treats an out-of-range Subtool index as a no-op', () => {
    const store = new EditorStore();
    store.armTerrain('ocean');

    store.armSubtoolByIndex(99);

    expect(store.terrain()).toBe('ocean');
  });

  it('ignores a Subtool index for a Tool that has no Subtools', () => {
    const store = new EditorStore();
    store.armTool('select');

    store.armSubtoolByIndex(1); // Select has no Subtools

    expect(store.tool()).toBe('select');
  });

  it('arms Select and resets Subtool memory when a document is loaded', () => {
    const store = new EditorStore();
    store.armTerrain('ocean');
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armRegion(id, 'add');

    store.load(emptyHexMap());

    expect(store.tool()).toBe('select');
    expect(store.terrain()).toBe('forest');
    expect(store.feature()).toBe('settlement');
    expect(store.region()).toBeNull();
  });

  it('auto-arms the first region when Region is armed with none remembered', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    store.createRegion('Whisperwood', '#7c9b86');

    // No Subtool picked yet — arming Region must land on a live region, not leave
    // the tool inert behind a populated legend (issue #27).
    store.armTool('region');

    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id: a, mode: 'add' });
  });

  it('arms no region Subtool when Region is armed on a region-less map', () => {
    const store = new EditorStore();

    store.armTool('region');

    expect(store.tool()).toBe('region');
    expect(store.region()).toBeNull();
  });

  it('restores the remembered region Subtool on re-arm rather than auto-picking', () => {
    const store = new EditorStore();
    store.createRegion('Avalon', '#b08a4e');
    const b = store.createRegion('Whisperwood', '#7c9b86');
    store.armRegion(b, 'remove'); // remember a non-first region in 'remove'
    store.armTool('select');

    store.armTool('region'); // re-arm must restore memory, not auto-pick the first

    expect(store.region()).toEqual({ id: b, mode: 'remove' });
  });

  it('clears the selected label when a document is loaded', () => {
    const store = new EditorStore();
    const first: HexMap = {
      ...emptyHexMap(),
      labels: [{ id: 'L1', text: 'A', position: { x: 0, y: 0 }, size: 28 }],
    };
    store.load(first);
    store.selectLabel('L1');
    expect(store.selectedLabel()?.id).toBe('L1');

    // Loading a different document that reuses the id must not keep the stale
    // selection — load() forgets it rather than relying on the id not colliding.
    const second: HexMap = {
      ...emptyHexMap(),
      labels: [{ id: 'L1', text: 'B', position: { x: 5, y: 5 }, size: 28 }],
    };
    store.load(second);
    expect(store.selectedLabel()).toBeNull();
  });
});

describe('EditorStore continuous', () => {
  it('treats Terrain as a continuous brush', () => {
    const store = new EditorStore();
    store.armTerrain('forest');
    expect(store.continuous()).toBe(true);
  });

  it('treats Erase as a continuous brush', () => {
    const store = new EditorStore();
    store.armTool('erase');
    expect(store.continuous()).toBe(true);
  });

  it('treats the Clear feature Subtool as a continuous brush', () => {
    const store = new EditorStore();
    store.armFeature('clear');
    expect(store.continuous()).toBe(true);
  });

  it('treats placing a Feature as a discrete stamp, not continuous', () => {
    const store = new EditorStore();
    store.armFeature('settlement');
    expect(store.continuous()).toBe(false);
  });

  it('treats painting a Region as a continuous brush', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armRegion(id, 'add');
    expect(store.continuous()).toBe(true);
  });

  it('treats placing a Label as a discrete stamp, not continuous', () => {
    const store = new EditorStore();
    store.armTool('label');
    expect(store.continuous()).toBe(false);
  });

  it('treats Select as non-continuous', () => {
    const store = new EditorStore();
    expect(store.continuous()).toBe(false);
  });
});

describe('EditorStore selection precedence', () => {
  it('selects the Label under the cursor over the hex beneath it (Label wins)', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const id = store.addLabel('Open Sea', { x: 5, y: 5 });

    store.select({ q: 0, r: 0 }, id);

    expect(store.selection()).toEqual({ kind: 'label', id });
  });

  it('selects the Feature on a hex that carries one, not the Hex beneath it', () => {
    const store = new EditorStore();
    store.paintAt({ q: 1, r: 2 }, 'forest');
    store.placeFeatureAt({ q: 1, r: 2 }, 'settlement');

    store.select({ q: 1, r: 2 }, null);

    expect(store.selection()).toEqual({ kind: 'feature', coord: { q: 1, r: 2 } });
  });

  it('selects a painted Hex that carries no Feature', () => {
    const store = new EditorStore();
    store.paintAt({ q: -3, r: 4 }, 'ocean');

    store.select({ q: -3, r: 4 }, null);

    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: -3, r: 4 } });
  });

  it('clears the selection on a Void coordinate with no label hit', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.select({ q: 0, r: 0 }, null); // something selected first

    store.select({ q: 9, r: 9 }, null); // Void, no label → deselect

    expect(store.selection()).toBeNull();
  });

  it('does not resolve a selected Hex as a Label (selectedLabel stays null)', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');

    store.select({ q: 0, r: 0 }, null);

    expect(store.selectedLabel()).toBeNull();
  });

  it('deselect clears the current selection', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).not.toBeNull();

    store.deselect();

    expect(store.selection()).toBeNull();
  });
});

describe('EditorStore Region selection cycle', () => {
  it('cycles from the Hex to the Region containing it on a repeated click', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });

    store.select({ q: 0, r: 0 }, null); // first click: the bare Hex
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });

    store.select({ q: 0, r: 0 }, null); // same coordinate again: descend to the Region
    expect(store.selection()).toEqual({ kind: 'region', id });
  });

  it('cycles Label → Feature → Region → wrap at a coordinate carrying all three', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement'); // a Feature rides the hex
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    const labelId = store.addLabel('Avalon', { x: 5, y: 5 }); // a Label hit there too

    // The label hit wins first; repeated clicks at the same coordinate descend.
    expect(store.select({ q: 0, r: 0 }, labelId)).toEqual({ kind: 'label', id: labelId });
    expect(store.select({ q: 0, r: 0 }, labelId)).toEqual({ kind: 'feature', coord: { q: 0, r: 0 } });
    expect(store.select({ q: 0, r: 0 }, labelId)).toEqual({ kind: 'region', id });
    // Past the last candidate the cycle wraps back to the top of the stack.
    expect(store.select({ q: 0, r: 0 }, labelId)).toEqual({ kind: 'label', id: labelId });
  });

  it('resets to the top of the stack when the next click lands on a different coordinate', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 }); // a Void member coordinate
    store.paintAt({ q: 1, r: 0 }, 'forest');
    store.addHexToRegion(id, { q: 1, r: 0 }); // a painted member of the same region

    store.select({ q: 0, r: 0 }, null); // descends to the Region (its only candidate)
    expect(store.selection()).toEqual({ kind: 'region', id });

    // A click on a *different* coordinate starts a fresh cycle at the top — the
    // painted Hex — rather than resuming the descent and skipping past it, even
    // though the same Region is also a candidate at the new coordinate.
    store.select({ q: 1, r: 0 }, null);
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 1, r: 0 } });
  });

  it('resets the cycle when the next click at the same coordinate hits a different label', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const first = store.addLabel('First', { x: 1, y: 1 });
    const second = store.addLabel('Second', { x: 2, y: 2 });

    store.select({ q: 0, r: 0 }, first); // cycle anchored on the first label
    expect(store.selection()).toEqual({ kind: 'label', id: first });

    // A different label hit at the same coordinate is a different target, so the
    // cycle restarts at that label rather than descending to the Hex beneath.
    store.select({ q: 0, r: 0 }, second);
    expect(store.selection()).toEqual({ kind: 'label', id: second });
  });

  it('selects the first containing Region (document order) on a Void coordinate, cycling through the rest', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    const b = store.createRegion('Whisperwood', '#7c9b86');
    store.addHexToRegion(a, { q: 4, r: 4 }); // a is added first → first in document order
    store.addHexToRegion(b, { q: 4, r: 4 });

    // The coordinate is Void (never painted), yet two Regions contain it: rather
    // than deselecting, the first in document order is selected, then the cycle
    // steps through the rest and wraps.
    store.select({ q: 4, r: 4 }, null);
    expect(store.selection()).toEqual({ kind: 'region', id: a });

    store.select({ q: 4, r: 4 }, null);
    expect(store.selection()).toEqual({ kind: 'region', id: b });

    store.select({ q: 4, r: 4 }, null);
    expect(store.selection()).toEqual({ kind: 'region', id: a });
  });

  it('deselects on a Void coordinate that no Region contains', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null); // something selected first

    // An empty coordinate outside every Region is a click on nothing → deselect.
    expect(store.select({ q: 9, r: 9 }, null)).toBeNull();
    expect(store.selection()).toBeNull();
  });

  it('clears a Region selection when that Region is deleted', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null); // the Region (its only candidate)
    expect(store.selection()).toEqual({ kind: 'region', id });

    store.deleteRegion(id); // the selection resolves against the live document…

    // …so a deleted Region leaves nothing selected rather than a dangling id.
    expect(store.selection()).toBeNull();
  });

  it('leaves a selected Region untouched on deleteSelected (Region deletion is the Inspector\'s job)', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).toEqual({ kind: 'region', id });

    store.deleteSelected(); // Delete/Backspace on a Region is a deliberate no-op here

    expect(store.document().regions[0].id).toBe(id);
    expect(store.selection()).toEqual({ kind: 'region', id });
  });
});

describe('EditorStore deleteSelected', () => {
  it('deletes the selected Label and clears the selection', () => {
    const store = new EditorStore();
    const id = store.addLabel('Doomed', { x: 0, y: 0 });
    store.selectLabel(id);

    store.deleteSelected();

    expect(store.document().labels).toEqual([]);
    expect(store.selection()).toBeNull();
  });

  it('deletes a selected Feature by clearing only the feature, leaving the terrain', () => {
    const store = new EditorStore();
    store.paintAt({ q: 1, r: 1 }, 'forest');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null); // selects the Feature (precedence)

    store.deleteSelected();

    expect(store.document().hexes['1,1']).toEqual({ terrain: 'forest' });
    expect(store.selection()).toBeNull();
  });

  it('deletes a selected Hex by erasing its whole record, back to Void', () => {
    const store = new EditorStore();
    store.paintAt({ q: -3, r: 4 }, 'ocean');
    store.placeFeatureAt({ q: -3, r: 4 }, 'ruin');
    // Selecting a hex that carries a feature selects the Feature, so clear the
    // feature first to get a bare-Hex selection (precedence: Feature wins).
    store.clearFeatureAt({ q: -3, r: 4 });
    store.select({ q: -3, r: 4 }, null);

    store.deleteSelected();

    expect('-3,4' in store.document().hexes).toBe(false);
    expect(store.selection()).toBeNull();
  });

  it('treats deleteSelected with nothing selected as a no-op with no undo step', () => {
    const store = new EditorStore();

    store.deleteSelected();

    expect(store.canUndo()).toBe(false);
  });

  it('records a single undoable step for a delete', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.select({ q: 0, r: 0 }, null); // the Feature

    store.deleteSelected();
    store.undo();

    // One undo restores the feature exactly — the delete was a single commit.
    expect(store.document().hexes['0,0']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
    });
  });
});

describe('EditorStore moveHex', () => {
  it('moves a hex\'s content to the destination, leaving the origin Void', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');

    store.moveHex({ q: 0, r: 0 }, { q: 2, r: -1 });

    expect(store.document().hexes['2,-1']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
    });
    expect('0,0' in store.document().hexes).toBe(false);
  });

  it('overwrites an already-occupied destination', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean'); // the destination is already painted

    store.moveHex({ q: 0, r: 0 }, { q: 1, r: 0 });

    expect(store.document().hexes['1,0']).toEqual({ terrain: 'forest' });
    expect('0,0' in store.document().hexes).toBe(false);
  });

  it('leaves region memberships at both the origin and destination untouched', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.addHexToRegion(id, { q: 0, r: 0 }); // origin is a region member
    store.addHexToRegion(id, { q: 1, r: 0 }); // so is the destination coordinate

    // A Region is a location overlay keyed by coordinate, not a property of the
    // painted cell, so moving content must not drag membership with it.
    store.moveHex({ q: 0, r: 0 }, { q: 1, r: 0 });

    expect(store.document().regions[0].hexes).toEqual({ '0,0': true, '1,0': true });
  });

  it('restores both the origin and the overwritten destination with a single undo', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.paintAt({ q: 1, r: 0 }, 'ocean'); // destination content that gets clobbered

    store.moveHex({ q: 0, r: 0 }, { q: 1, r: 0 });
    store.undo();

    // One undo step puts both ends back: the origin returns and the destination
    // recovers what it was before the overwrite — no silent loss (ADR-0010).
    expect(store.document().hexes['0,0']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
    });
    expect(store.document().hexes['1,0']).toEqual({ terrain: 'ocean' });
  });

  it('treats moving onto the same coordinate as a no-op with no undo step', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');

    store.moveHex({ q: 0, r: 0 }, { q: 0, r: 0 });

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
    // The paint is the only undo step: a single undo empties the map, proving the
    // self-move recorded nothing.
    store.undo();
    expect(store.canUndo()).toBe(false);
    expect(store.document().hexes).toEqual({});
  });

  it('treats moving a Void origin as a no-op with no undo step', () => {
    const store = new EditorStore();
    store.paintAt({ q: 1, r: 0 }, 'ocean'); // a painted destination

    store.moveHex({ q: 5, r: 5 }, { q: 1, r: 0 }); // origin is Void → nothing moves

    expect(store.document().hexes['1,0']).toEqual({ terrain: 'ocean' });
    expect('5,5' in store.document().hexes).toBe(false);
    // Only the paint recorded a step; undoing it leaves nothing further to undo.
    store.undo();
    expect(store.canUndo()).toBe(false);
    expect(store.document().hexes).toEqual({});
  });

  it('moves a terrain-only hex without inventing a feature on the destination', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest'); // bare terrain, no feature

    store.moveHex({ q: 0, r: 0 }, { q: 2, r: -1 });

    // The clone carries exactly what the origin held — no `feature` key appears.
    expect(store.document().hexes['2,-1']).toEqual({ terrain: 'forest' });
    expect('feature' in store.document().hexes['2,-1']).toBe(false);
  });

  it('keeps the moved hex selected, following the selection to the destination', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null); // the bare Hex is selected

    store.moveHex({ q: 0, r: 0 }, { q: 2, r: -1 });

    // Completing a move keeps the moved content selected at its new coordinate,
    // matching the Label-drag path rather than silently deselecting.
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 2, r: -1 } });
  });

  it('leaves a selection elsewhere untouched when a different hex is moved', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 3, r: 3 }, 'ocean');
    store.select({ q: 3, r: 3 }, null); // a different hex is selected

    store.moveHex({ q: 0, r: 0 }, { q: 2, r: -1 });

    // Only a selection that pointed at the moved origin follows; this one stays.
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 3, r: 3 } });
  });

  it('moves the selection back to the origin when the move is undone', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);

    store.moveHex({ q: 0, r: 0 }, { q: 2, r: -1 });
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 2, r: -1 } });

    store.undo();

    // Undo restores the document AND the selection in lockstep: the hex is back at
    // the origin and selected there, not a stale reference to the empty destination.
    expect('2,-1' in store.document().hexes).toBe(false);
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });
  });

  it('does not leave the selection highlighting clobbered content after an undo', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean'); // destination content that gets clobbered
    store.select({ q: 0, r: 0 }, null); // the origin hex is selected

    store.moveHex({ q: 0, r: 0 }, { q: 1, r: 0 });
    store.undo();

    // The destination's ocean is restored, but the selection follows the moved hex
    // back to its origin rather than silently highlighting the recovered ocean.
    expect(store.document().hexes['1,0']).toEqual({ terrain: 'ocean' });
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });
  });

  it('follows the selection back to the destination when the move is redone', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);

    store.moveHex({ q: 0, r: 0 }, { q: 2, r: -1 });
    store.undo();
    store.redo();

    // Redo re-applies the move and its resulting selection, so the moved hex is
    // selected at the destination again — no stale origin reference resolving null.
    expect(store.document().hexes['2,-1']).toEqual({ terrain: 'forest' });
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 2, r: -1 } });
  });
});
