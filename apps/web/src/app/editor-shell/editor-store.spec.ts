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

  it('deleteSelected destroys a selected Region as one undoable step, restoring its membership and selection on undo', () => {
    const store = new EditorStore();
    const id = 'reg-avalon';
    // `load` clears history, so the deletion is the one and only edit on the stack
    // — a single undo that fully restores the Region then proves it is one step.
    store.load({
      hexes: {},
      regions: [{ id, name: 'Avalon', color: '#b08a4e', hexes: { '1,1': true } }],
      labels: [],
    });
    store.select({ q: 1, r: 1 }, null); // the only candidate there: the Region

    store.deleteSelected(); // the Delete/Backspace path
    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();

    store.undo(); // a single step brings the Region — membership and all — back
    expect(store.document().regions[0].hexes).toEqual({ '1,1': true });
    expect(store.selection()).toEqual({ kind: 'region', id });
    expect(store.canUndo()).toBe(false); // it really was one step, not two
  });

  it('disarms the Region tool when its armed Region is deleted, and undo does not re-arm it', () => {
    const store = new EditorStore();
    const id = 'reg-avalon';
    store.load({
      hexes: {},
      regions: [{ id, name: 'Avalon', color: '#b08a4e', hexes: { '1,1': true } }],
      labels: [],
    });
    store.armRegion(id, 'add'); // arm the Region tool on it…
    store.select({ q: 1, r: 1 }, null); // …and select it

    store.deleteSelected();
    expect(store.document().regions).toEqual([]);
    // The now-dangling Region tool falls back to the inert Select.
    expect(store.tool()).toBe('select');
    expect(store.region()).toBeNull();

    store.undo(); // restores the document and selection — but NOT the tool arming:
    expect(store.document().regions[0].id).toBe(id);
    expect(store.selection()).toEqual({ kind: 'region', id });
    // Tool/subtool memory is session-only state (issue #27), never part of an
    // undoable edit, so it stays on Select rather than re-arming the Region tool.
    expect(store.tool()).toBe('select');
    expect(store.region()).toBeNull();
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

  it('ignores a Subtool index while the Region tool is armed (no Subtools)', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    store.createRegion('Whisperwood', '#7c9b86');
    store.armRegion(a, 'remove'); // armed on Avalon

    store.armSubtoolByIndex(2); // the Region tool has no Subtools, so 1–9 do nothing

    // The armed Region is untouched — the index neither switched regions nor mode.
    expect(store.region()).toEqual({ id: a, mode: 'remove' });
  });

  it('treats an out-of-range Subtool index as a no-op', () => {
    const store = new EditorStore();
    store.armTerrain('ocean');

    store.armSubtoolByIndex(99);

    expect(store.terrain()).toBe('ocean');
  });

  it('ignores a Subtool index for a Tool that has no Subtools', () => {
    const store = new EditorStore();
    store.armTool('label'); // Label has no Subtools (nor does Erase)

    store.armSubtoolByIndex(1);

    // The index neither armed anything nor disturbed the Tool.
    expect(store.tool()).toBe('label');
  });

  it('arms Select and resets Subtool memory when a document is loaded', () => {
    const store = new EditorStore();
    store.armTerrain('ocean');
    store.armSelectSubtool('marquee'); // move the Select Subtool off its boot default
    const id = store.createRegion('Avalon', '#b08a4e');
    store.armRegion(id, 'add');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null); // select the Region so the toggle can engage
    store.armRegionDirection('remove'); // move the membership direction off cold-start

    store.load(emptyHexMap());

    expect(store.tool()).toBe('select');
    expect(store.selectSubtool()).toBe('pick');
    expect(store.terrain()).toBe('forest');
    expect(store.feature()).toBe('settlement');
    expect(store.region()).toBeNull();
    // A reloaded map matches a fresh store, so the membership direction cold-starts
    // back at Add rather than carrying the previous map's toggle choice.
    expect(store.regionDirection()).toBe('add');
  });

  it('does not auto-arm a region when Region is armed with none remembered', () => {
    const store = new EditorStore();
    store.createRegion('Avalon', '#b08a4e');
    store.createRegion('Whisperwood', '#7c9b86');

    store.armTool('region');

    // Create-and-paint replaces the old auto-arm-first-region (issue #27 → #38): the
    // tool arms with no Region, so the first canvas stroke mints a new one rather
    // than silently painting an arbitrary existing region.
    expect(store.tool()).toBe('region');
    expect(store.region()).toBeNull();
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

describe('EditorStore Select Subtools (Pick/Marquee)', () => {
  it('cold-starts the Select Subtool at Pick so boot behaviour is unchanged', () => {
    const store = new EditorStore();

    expect(store.selectSubtool()).toBe('pick');
  });

  it('arms Select and sets its Subtool together when one is picked', () => {
    const store = new EditorStore();
    store.armTool('terrain'); // start on another Tool

    store.armSelectSubtool('marquee');

    expect(store.tool()).toBe('select');
    expect(store.selectSubtool()).toBe('marquee');
  });

  it('remembers the Select Subtool across a Tool switch and restores it on re-arm', () => {
    const store = new EditorStore();
    store.armSelectSubtool('marquee');

    store.armTool('terrain'); // leave Select — its Subtool memory must survive
    store.armTool('select'); // re-arm Select

    expect(store.selectSubtool()).toBe('marquee');
  });

  it('picks Pick and Marquee by Subtool index 1 and 2 while Select is armed', () => {
    const store = new EditorStore();
    store.armTool('select');

    store.armSubtoolByIndex(2);
    expect(store.selectSubtool()).toBe('marquee');

    store.armSubtoolByIndex(1);
    expect(store.selectSubtool()).toBe('pick');
  });

  it('treats an out-of-range Select Subtool index as a no-op', () => {
    const store = new EditorStore();
    store.armSelectSubtool('marquee');

    store.armSubtoolByIndex(3); // Select has only two Subtools

    expect(store.selectSubtool()).toBe('marquee');
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

  it('destroys a selected Region on deleteSelected, clearing the selection (issue #36)', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).toEqual({ kind: 'region', id });

    store.deleteSelected(); // Delete/Backspace destroys the Region via the shared path

    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();
  });

  it('restarts the cycle at the top after a non-click path changed the selection', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });

    store.select({ q: 0, r: 0 }, null); // top of the stack: the bare Hex
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });

    // The selection is moved to a Label through a non-click path (the Label tool
    // drop / Inspector) — no deselect, so the cycle anchor still names {0,0}.
    const labelId = store.addLabel('Avalon', { x: 5, y: 5 });
    store.selectLabel(labelId);
    expect(store.selection()).toEqual({ kind: 'label', id: labelId });

    // Clicking the same coordinate must restart at the top (the Hex), not resume
    // the stale descent into the Region: the cycle position is derived from where
    // the *live* selection sits in the stack, and the Label isn't a candidate here.
    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });
  });

  it('re-derives the descent from the live selection when the stack changes under the anchor', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 }); // a Void member: the stack is [Region]

    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).toEqual({ kind: 'region', id });

    // Painting the cell grows the stack to [Hex, Region] without a deselect. The
    // next click at the same anchor descends from the still-selected Region (the
    // last candidate) and wraps to the new top (the Hex), rather than reusing a
    // stale index that would re-pick the Region.
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });
  });
});

describe('EditorStore marqueeSelect', () => {
  it('replaces the selection with the marquee’s hexes and labels on a plain marquee', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    const labelId = store.addLabel('Avalon', { x: 5, y: 5 });
    store.select({ q: 5, r: 5 }, null); // a prior selection the marquee must replace
    store.paintAt({ q: 5, r: 5 }, 'grass');
    store.select({ q: 5, r: 5 }, null);

    store.marqueeSelect([{ q: 0, r: 0 }, { q: 1, r: 0 }], [labelId], false);

    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
      { kind: 'label', id: labelId },
    ]);
  });

  it('accumulates across boxes on an additive marquee, never dropping a member', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.paintAt({ q: 2, r: 0 }, 'grass');

    store.marqueeSelect([{ q: 0, r: 0 }], [], false); // first box
    store.marqueeSelect([{ q: 1, r: 0 }, { q: 2, r: 0 }], [], true); // add a second box

    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
      { kind: 'hex', coord: { q: 2, r: 0 } },
    ]);
  });

  it('does not re-add a hex an additive marquee already holds', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');

    store.marqueeSelect([{ q: 0, r: 0 }], [], false);
    store.marqueeSelect([{ q: 0, r: 0 }, { q: 1, r: 0 }], [], true); // overlaps the first box

    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
    ]);
  });

  it('clears the set when a plain marquee hits nothing, but an additive one leaves it', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.marqueeSelect([{ q: 0, r: 0 }], [], false);

    store.marqueeSelect([], [], true); // empty additive box — keeps the selection
    expect(store.selections()).toHaveLength(1);

    store.marqueeSelect([], [], false); // empty plain box — clears it
    expect(store.selections()).toEqual([]);
  });

  it('opens the Inspector on a marquee that selects something', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');

    store.marqueeSelect([{ q: 0, r: 0 }], [], false);

    expect(store.rightPanel()).toBe('inspector');
  });
});

describe('EditorStore marqueePreview', () => {
  it('previews the box’s hexes and labels without committing them (plain)', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    const labelId = store.addLabel('Avalon', { x: 5, y: 5 });
    // A prior selection the live preview of a *plain* marquee must not include.
    store.paintAt({ q: 9, r: 9 }, 'grass');
    store.select({ q: 9, r: 9 }, null);

    const preview = store.marqueePreview(
      [{ q: 0, r: 0 }, { q: 1, r: 0 }],
      [labelId],
      false,
    );

    expect(preview).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
      { kind: 'label', id: labelId },
    ]);
    // It is a pure query: the committed selection is untouched by the preview.
    expect(store.selections()).toEqual([{ kind: 'hex', coord: { q: 9, r: 9 } }]);
  });

  it('previews a featured cell as a Feature, matching what release would select', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');

    const preview = store.marqueePreview([{ q: 0, r: 0 }], [], false);

    expect(preview).toEqual([{ kind: 'feature', coord: { q: 0, r: 0 } }]);
  });

  it('unions the committed selection with the box on an additive preview', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.marqueeSelect([{ q: 0, r: 0 }], [], false); // committed: hex 0,0

    const preview = store.marqueePreview([{ q: 1, r: 0 }], [], true);

    expect(preview).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
    ]);
    // Still a pure query — the committed set did not grow.
    expect(store.selections()).toEqual([{ kind: 'hex', coord: { q: 0, r: 0 } }]);
  });

  it('does not duplicate an already-selected hex in an additive preview', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.marqueeSelect([{ q: 0, r: 0 }], [], false);

    const preview = store.marqueePreview([{ q: 0, r: 0 }], [], true);

    expect(preview).toEqual([{ kind: 'hex', coord: { q: 0, r: 0 } }]);
  });
});

describe('EditorStore multi-selection set', () => {
  it('builds a set when Cmd/Ctrl-click toggles a second topmost entity in', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');

    store.select({ q: 0, r: 0 }, null); // plain click selects the first hex
    store.select({ q: 1, r: 0 }, null, 'toggle-top'); // Cmd/Ctrl-click adds the second

    // Both hexes are now selected — the Selection is a set, not a single ref.
    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
    ]);
    // With two selected, the singular selection() reads as null (exactly-one-or-null).
    expect(store.selection()).toBeNull();
  });

  it('toggles the topmost entity back out on a second Cmd/Ctrl-click', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.select({ q: 0, r: 0 }, null);
    store.select({ q: 1, r: 0 }, null, 'toggle-top'); // adds the second

    store.select({ q: 1, r: 0 }, null, 'toggle-top'); // toggles it back out

    expect(store.selections()).toEqual([{ kind: 'hex', coord: { q: 0, r: 0 } }]);
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 0, r: 0 } });
  });

  it('Shift-click toggles the whole stack at a coordinate into the set', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest'); // a bare Hex…
    const region = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(region, { q: 0, r: 0 }); // …inside a Region
    const labelId = store.addLabel('Avalon', { x: 5, y: 5 }); // …under a Label

    store.select({ q: 0, r: 0 }, labelId, 'toggle-stack');

    // The whole pile is selected at once — a heterogeneous set (Label + Hex + Region).
    expect(store.selections()).toEqual([
      { kind: 'label', id: labelId },
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'region', id: region },
    ]);
  });

  it('Shift-click on an already-fully-selected stack removes all of it', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const region = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(region, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null, 'toggle-stack'); // Hex + Region in
    expect(store.selections()).toHaveLength(2);

    store.select({ q: 0, r: 0 }, null, 'toggle-stack'); // the pile is full → remove all

    expect(store.selections()).toEqual([]);
  });

  it('Shift-click adds only the missing members of a partly-selected stack', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const region = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(region, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null); // plain click selects just the Hex

    store.select({ q: 0, r: 0 }, null, 'toggle-stack'); // not full → add the missing Region

    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'region', id: region },
    ]);
  });

  it('a plain click replaces the whole set with the single topmost entity', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.select({ q: 0, r: 0 }, null);
    store.select({ q: 1, r: 0 }, null, 'toggle-top'); // build a two-entity set
    expect(store.selections()).toHaveLength(2);

    store.select({ q: 1, r: 0 }, null); // a plain click collapses the set to one

    expect(store.selections()).toEqual([{ kind: 'hex', coord: { q: 1, r: 0 } }]);
  });

  it('drops a stale member when its entity is deleted, keeping the rest', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const labelId = store.addLabel('Doomed', { x: 5, y: 5 });
    store.select({ q: 0, r: 0 }, null);
    store.select({ q: 0, r: 0 }, labelId, 'toggle-top'); // set = [Hex, Label]
    expect(store.selections()).toHaveLength(2);

    store.deleteLabel(labelId); // the Label is gone from the document…

    // …so it self-heals out of the set, leaving the surviving Hex selected.
    expect(store.selections()).toEqual([{ kind: 'hex', coord: { q: 0, r: 0 } }]);
  });

  it('clears the whole set on a plain click in empty space', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.select({ q: 0, r: 0 }, null);
    store.select({ q: 1, r: 0 }, null, 'toggle-top');
    expect(store.selections()).toHaveLength(2);

    store.select({ q: 9, r: 9 }, null); // plain click on Void clears everything

    expect(store.selections()).toEqual([]);
  });

  it('add-top adds the topmost entity without removing existing members, idempotently', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.select({ q: 0, r: 0 }, null); // [hex 0,0]

    // A modifier-held drag sweeps in each hovered hex via the add-only path — it
    // accumulates rather than toggling, so re-entering a hex never removes it.
    store.select({ q: 1, r: 0 }, null, 'add-top');
    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
    ]);

    store.select({ q: 1, r: 0 }, null, 'add-top'); // re-hovering the same hex is a no-op
    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'hex', coord: { q: 1, r: 0 } },
    ]);
  });

  it('add-stack adds the whole stack at a coordinate, never removing it on re-entry', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const region = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(region, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null); // [hex]

    store.select({ q: 0, r: 0 }, null, 'add-stack'); // adds the Region (hex already in)
    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'region', id: region },
    ]);

    store.select({ q: 0, r: 0 }, null, 'add-stack'); // fully present → unchanged, not removed
    expect(store.selections()).toEqual([
      { kind: 'hex', coord: { q: 0, r: 0 } },
      { kind: 'region', id: region },
    ]);
  });

  it('add-* over empty space leaves the set unchanged', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);

    store.select({ q: 9, r: 9 }, null, 'add-top'); // sweeping over Void adds nothing

    expect(store.selections()).toEqual([{ kind: 'hex', coord: { q: 0, r: 0 } }]);
  });

  it('deletes a heterogeneous set per kind in a single undo step, restoring all on undo', () => {
    const store = new EditorStore();
    // `load` clears history so the multi-delete is the one and only edit on the
    // stack — a single undo that fully restores everything then proves it is one step.
    store.load({
      hexes: {
        '0,0': { terrain: 'forest' },
        '1,0': { terrain: 'grass', feature: { ref: 'settlement' } },
      },
      regions: [{ id: 'reg', name: 'Avalon', color: '#b08a4e', hexes: { '2,2': true } }],
      labels: [{ id: 'lab', text: 'Doomed', position: { x: 5, y: 5 }, size: 28 }],
    });
    // Build a four-entity heterogeneous set: a bare Hex, a Feature, a Region, a Label.
    store.select({ q: 0, r: 0 }, null);
    store.select({ q: 1, r: 0 }, null, 'toggle-top'); // the Feature on 1,0
    store.select({ q: 2, r: 2 }, null, 'toggle-top'); // the Region (Void member)
    store.select({ q: 0, r: 0 }, 'lab', 'toggle-top'); // the Label
    expect(store.selections()).toHaveLength(4);

    store.deleteSelected();

    // Each entity is removed per its kind: the Hex erased back to Void, the Feature
    // cleared (terrain stays), the Region destroyed, the Label removed.
    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.document().hexes['1,0']).toEqual({ terrain: 'grass' });
    expect(store.document().regions).toEqual([]);
    expect(store.document().labels).toEqual([]);
    expect(store.selections()).toEqual([]);

    store.undo(); // a single step brings the whole set back

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
    expect(store.document().hexes['1,0']).toEqual({
      terrain: 'grass',
      feature: { ref: 'settlement' },
    });
    expect(store.document().regions[0].hexes).toEqual({ '2,2': true });
    expect(store.document().labels).toHaveLength(1);
    expect(store.selections()).toHaveLength(4);
    expect(store.canUndo()).toBe(false); // it really was one step, not four
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

describe('EditorStore moveSelection', () => {
  const ZERO = { x: 0, y: 0 };

  it('translates a whole multi-hex selection by one offset, keeping its shape', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.marqueeSelect([{ q: 0, r: 0 }, { q: 1, r: 0 }], [], false);

    store.moveSelection({ q: 0, r: 2 }, ZERO);

    // Both members rode by the same offset; the cluster keeps its internal shape
    // and the whole records (feature included) travel along.
    expect(store.document().hexes['0,2']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
    });
    expect(store.document().hexes['1,2']).toEqual({ terrain: 'ocean' });
    expect('0,0' in store.document().hexes).toBe(false);
    expect('1,0' in store.document().hexes).toBe(false);
    // The selection re-points to the moved entities, so the group stays selected.
    expect(store.selections()).toEqual(
      expect.arrayContaining([
        { kind: 'feature', coord: { q: 0, r: 2 } },
        { kind: 'hex', coord: { q: 1, r: 2 } },
      ]),
    );
    expect(store.selections()).toHaveLength(2);
  });

  it('shifts a contiguous blob by one cell without fighting itself (intra-group overlap)', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.marqueeSelect([{ q: 0, r: 0 }, { q: 1, r: 0 }], [], false);

    store.moveSelection({ q: 1, r: 0 }, ZERO);

    // A nudge that lands one member on another's vacated cell just shifts: the tail
    // clears, the rest is rewritten — no member is destroyed.
    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.document().hexes['1,0']).toEqual({ terrain: 'forest' });
    expect(store.document().hexes['2,0']).toEqual({ terrain: 'ocean' });
  });

  it('swaps a non-selected occupant back to d − offset when that cell is free', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 0, r: 1 }, 'grass');
    store.paintAt({ q: 3, r: 0 }, 'ocean'); // a non-selected occupant at one destination
    store.marqueeSelect([{ q: 0, r: 0 }, { q: 0, r: 1 }], [], false);

    store.moveSelection({ q: 3, r: 0 }, ZERO);

    expect(store.document().hexes['3,0']).toEqual({ terrain: 'forest' });
    expect(store.document().hexes['3,1']).toEqual({ terrain: 'grass' });
    // The occupant swapped back by the inverse offset to (0,0), a vacated source.
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'ocean' });
    expect('0,1' in store.document().hexes).toBe(false);
  });

  it('refuses a blocked move entirely: no document change, no undo step, selection intact', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.paintAt({ q: 2, r: 0 }, 'mountain'); // X: pushing it back lands where A is going
    store.marqueeSelect([{ q: 0, r: 0 }, { q: 1, r: 0 }], [], false);
    const before = structuredClone(store.document());

    store.moveSelection({ q: 1, r: 0 }, ZERO);

    // A self-overlapping nudge blocks: the document is untouched and the move
    // recorded nothing, so undoing reaches only the setup paints, never a no-op step.
    expect(store.document()).toEqual(before);
    expect(store.selections()).toHaveLength(2);
    store.undo(); // undoes the last paint (mountain), proving no move step exists
    expect(store.document().hexes['2,0']).toBeUndefined();
    expect(store.canRedo()).toBe(true);
  });

  it('translates a selected region\'s footprint by the offset, keeping it selected', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.addHexToRegion(id, { q: 1, r: 0 });
    store.selectRegion(id);

    store.moveSelection({ q: 0, r: 3 }, ZERO);

    expect(store.document().regions[0].hexes).toEqual({ '0,3': true, '1,3': true });
    expect(store.selection()).toEqual({ kind: 'region', id });
  });

  it('moves a labels-only selection by free pixels, keeping the label selected', () => {
    const store = new EditorStore();
    const id = store.addLabel('Whisperwood', { x: 10, y: 10 });
    store.selectLabel(id);

    // No hex/region in the set, so the axial offset is zero; the label rides by the
    // free pixel delta the drag decided.
    store.moveSelection({ q: 0, r: 0 }, { x: 7, y: -3 });

    expect(store.document().labels[0].position).toEqual({ x: 17, y: 7 });
    expect(store.selection()).toEqual({ kind: 'label', id });
  });

  it('applies a mixed hex + region + label move as one undo step', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    const regionId = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(regionId, { q: 0, r: 0 });
    const labelId = store.addLabel('X', { x: 0, y: 0 });
    // Build the heterogeneous set: the cell + label via marquee, then the region via
    // a shift-toggle of the stack at the painted, region-owning coordinate.
    store.marqueeSelect([{ q: 0, r: 0 }], [labelId], false);
    store.select({ q: 0, r: 0 }, null, 'toggle-stack');

    store.moveSelection({ q: 0, r: 1 }, { x: 5, y: 0 });

    expect(store.document().hexes['0,1']).toEqual({ terrain: 'forest' });
    expect(store.document().regions[0].hexes).toEqual({ '0,1': true });
    expect(store.document().labels[0].position).toEqual({ x: 5, y: 0 });

    // One undo step reverts the hex, the region footprint, and the label together.
    store.undo();
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
    expect('0,1' in store.document().hexes).toBe(false);
    expect(store.document().regions[0].hexes).toEqual({ '0,0': true });
    expect(store.document().labels[0].position).toEqual({ x: 0, y: 0 });
  });

  it('moves a single selected hex onto Void, re-pointing the selection', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.select({ q: 0, r: 0 }, null);

    store.moveSelection({ q: 2, r: -1 }, ZERO);

    expect(store.document().hexes['2,-1']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
    });
    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.selection()).toEqual({ kind: 'feature', coord: { q: 2, r: -1 } });
  });

  it('swaps a single selected hex onto an occupant, selecting only the moved record', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.editHexName({ q: 1, r: 0 }, 'The Deep');
    store.select({ q: 0, r: 0 }, null); // only the origin is selected

    store.moveSelection({ q: 1, r: 0 }, ZERO);

    expect(store.document().hexes['1,0']).toEqual({ terrain: 'forest', name: 'Riverbend' });
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'ocean', name: 'The Deep' });
    // Only the moved hex follows; the swapped-back occupant is not in the selection.
    expect(store.selection()).toEqual({ kind: 'hex', coord: { q: 1, r: 0 } });
  });

  it('restores the whole group with a single undo and re-applies it on redo', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    store.marqueeSelect([{ q: 0, r: 0 }, { q: 1, r: 0 }], [], false);

    store.moveSelection({ q: 0, r: 2 }, ZERO);
    store.undo();

    // One step puts both origins back and the selection with them.
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
    expect(store.document().hexes['1,0']).toEqual({ terrain: 'ocean' });
    expect('0,2' in store.document().hexes).toBe(false);
    expect(store.selections()).toEqual(
      expect.arrayContaining([
        { kind: 'hex', coord: { q: 0, r: 0 } },
        { kind: 'hex', coord: { q: 1, r: 0 } },
      ]),
    );

    store.redo();
    expect(store.document().hexes['0,2']).toEqual({ terrain: 'forest' });
    expect(store.document().hexes['1,2']).toEqual({ terrain: 'ocean' });
    expect(store.selections()).toEqual(
      expect.arrayContaining([
        { kind: 'hex', coord: { q: 0, r: 2 } },
        { kind: 'hex', coord: { q: 1, r: 2 } },
      ]),
    );
  });

  it('treats a drag that never moved (zero offset and pixels) as a no-op', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);

    store.moveSelection({ q: 0, r: 0 }, ZERO);

    // No move step recorded: the only undo is the paint, after which nothing remains.
    store.undo();
    expect(store.canUndo()).toBe(false);
    expect(store.document().hexes).toEqual({});
  });
});

describe('EditorStore hex name', () => {
  it('names a painted hex', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');

    store.editHexName({ q: 0, r: 0 }, 'Riverbend');

    expect(store.document().hexes['0,0']).toEqual({
      terrain: 'forest',
      name: 'Riverbend',
    });
  });

  it('undo reverses a rename', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');

    store.undo();

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
  });

  it('naming a Void coordinate is a no-op that paints no hex and records no undo step', () => {
    const store = new EditorStore();

    store.editHexName({ q: 0, r: 0 }, 'Riverbend');

    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('clearing the name to blank removes the field rather than leaving an empty string', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');

    store.editHexName({ q: 0, r: 0 }, '   ');

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
  });

  it('clearing the feature leaves the name intact', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');

    store.clearFeatureAt({ q: 0, r: 0 });

    expect(store.document().hexes['0,0']).toEqual({
      terrain: 'forest',
      name: 'Riverbend',
    });
  });

  it('erasing the hex removes the name with the rest of the record', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');

    store.eraseAt({ q: 0, r: 0 });

    expect('0,0' in store.document().hexes).toBe(false);
  });

  it('carries the name with the hex on a single-hex move', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');
    store.select({ q: 0, r: 0 }, null);

    store.moveSelection({ q: 2, r: -1 }, { x: 0, y: 0 });

    expect(store.document().hexes['2,-1']).toEqual({
      terrain: 'forest',
      name: 'Riverbend',
    });
    expect('0,0' in store.document().hexes).toBe(false);
  });
});

describe('EditorStore region direction', () => {
  /**
   * Select a fresh Region (its single member at a Void coordinate, so the Region
   * is the only candidate there) and return the store and the region id.
   */
  function withSelectedRegion() {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null);
    return { store, id };
  }

  it('arms the Region tool on the selected Region in the Add direction', () => {
    const { store, id } = withSelectedRegion();

    store.armRegionDirection('add');

    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id, mode: 'add' });
    expect(store.regionDirection()).toBe('add');
  });

  it('arms the Region tool on the selected Region in the Remove direction', () => {
    const { store, id } = withSelectedRegion();

    store.armRegionDirection('remove');

    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id, mode: 'remove' });
    expect(store.regionDirection()).toBe('remove');
  });

  it('cold-starts the membership direction at Add', () => {
    const store = new EditorStore();

    expect(store.regionDirection()).toBe('add');
  });

  it('does not arm the Region tool, or move the direction, when no Region is selected', () => {
    const store = new EditorStore();
    store.createRegion('Avalon', '#b08a4e'); // exists, but is not selected

    // Engage the *non-default* direction: were the guard not honoured, the armed
    // Subtool's mode (and so regionDirection) would read 'remove' below.
    store.armRegionDirection('remove');

    // Nothing is inspected, so there is no Region to arm on — the tool stays on the
    // non-destructive Select, no Region Subtool is armed, and the toggle direction
    // (derived from the armed Subtool's mode) cold-stays at Add rather than moving.
    expect(store.tool()).toBe('select');
    expect(store.region()).toBeNull();
    expect(store.regionDirection()).toBe('add');
  });

  it('reflects the armed Region Subtool mode however it was armed, so the toggle never disagrees with the brush', () => {
    const { store, id } = withSelectedRegion();

    // Arm via the palette path (`armRegion`), not the toggle: the Inspector toggle
    // must still reflect it, because the direction is derived from the armed Subtool
    // rather than a separate, hand-synced signal — and it is what `applyAt` paints by.
    store.armRegion(id, 'remove');
    expect(store.regionDirection()).toBe('remove');

    store.armRegion(id, 'add');
    expect(store.regionDirection()).toBe('add');
  });

  it('does not inherit a stale Region\'s direction when a different Region is selected', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    const b = store.createRegion('Brevoy', '#7c9b86');
    store.addHexToRegion(a, { q: 0, r: 0 });
    store.addHexToRegion(b, { q: 1, r: 1 });

    // Arm A in Remove (the non-default direction), then select a *different* Region B
    // through the Select tool — which moves the selection but leaves the armed Subtool
    // pointing at A. The toggle and brush must reflect B, not A's stale 'remove'.
    store.select({ q: 0, r: 0 }, null); // selects A, the only candidate there
    store.armRegionDirection('remove'); // _region = { a, 'remove' }
    store.armTool('select');
    store.select({ q: 1, r: 1 }, null); // selects B; _region still points at A

    // The direction falls back to Add rather than inheriting A's 'remove', so a stroke
    // on the freshly-selected B adds — it never silently erases membership.
    expect(store.regionDirection()).toBe('add');
    store.armTool('region');
    store.applyAt({ q: 2, r: 2 });
    expect(store.document().regions.find((r) => r.id === b)?.hexes['2,2']).toBe(true);
  });

  it('arms and paints the selected Region — not merely the first — when several exist', () => {
    const store = new EditorStore();
    const first = store.createRegion('First', '#7c9b86');
    const second = store.createRegion('Second', '#b08a4e');
    store.addHexToRegion(second, { q: 0, r: 0 }); // the only candidate at 0,0
    store.select({ q: 0, r: 0 }, null); // selects `second`, the later region

    store.armRegionDirection('add');
    store.applyAt({ q: 9, r: 9 });

    expect(store.region()).toEqual({ id: second, mode: 'add' });
    const secondHexes = store.document().regions.find((r) => r.id === second)?.hexes;
    const firstHexes = store.document().regions.find((r) => r.id === first)?.hexes;
    expect(secondHexes?.['9,9']).toBe(true);
    expect('9,9' in (firstHexes ?? {})).toBe(false);
  });

  it('paints a hex into the selected Region when armed in Add and applied', () => {
    const { store, id } = withSelectedRegion();

    store.armRegionDirection('add');
    store.applyAt({ q: 5, r: 5 });

    expect(store.document().regions[0].hexes['5,5']).toBe(true);
    expect(id).toBe(store.document().regions[0].id);
  });

  it('erases a member hex from the selected Region when armed in Remove and applied', () => {
    const { store } = withSelectedRegion(); // member at 0,0

    store.armRegionDirection('remove');
    store.applyAt({ q: 0, r: 0 });

    expect('0,0' in store.document().regions[0].hexes).toBe(false);
  });

  it('leaves an empty Region present when its last member is erased — never auto-deletes it', () => {
    const { store, id } = withSelectedRegion(); // its only member is 0,0

    store.armRegionDirection('remove');
    store.applyAt({ q: 0, r: 0 });

    // The Region survives with empty membership; trimming never destroys a Region.
    expect(store.document().regions).toHaveLength(1);
    expect(store.document().regions[0].id).toBe(id);
    expect(store.document().regions[0].hexes).toEqual({});
  });

  it('makes membership painting undoable and redoable', () => {
    const { store } = withSelectedRegion();

    store.armRegionDirection('add');
    store.applyAt({ q: 5, r: 5 });
    store.undo();
    expect('5,5' in store.document().regions[0].hexes).toBe(false);

    store.redo();
    expect(store.document().regions[0].hexes['5,5']).toBe(true);
  });

  it('makes remove-direction membership painting undoable and redoable', () => {
    const { store } = withSelectedRegion(); // member at 0,0

    store.armRegionDirection('remove');
    store.applyAt({ q: 0, r: 0 });
    expect('0,0' in store.document().regions[0].hexes).toBe(false);

    store.undo();
    expect(store.document().regions[0].hexes['0,0']).toBe(true);

    store.redo();
    expect('0,0' in store.document().regions[0].hexes).toBe(false);
  });
});

describe('EditorStore Region tool (membership brush only)', () => {
  it('does not mint a Region on a stroke when armed with none selected', () => {
    const store = new EditorStore();
    store.armTool('region'); // armed, but nothing is selected

    store.applyAt({ q: 2, r: 3 });

    // Creation is panel-only now (ADR-0012): a Region stroke with no selected Region
    // paints nothing and mints nothing — there is no create-and-paint anymore.
    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();
  });

  it('paints the selected Region\'s membership on a stroke (the only remaining job)', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.selectRegion(id);
    store.armRegion(id, 'add'); // the Inspector's Add/Remove path arms the brush

    store.applyAt({ q: 2, r: 3 });

    expect(store.document().regions[0].hexes).toEqual({ '2,3': true });
  });
});

describe('EditorStore New Region (from the Regions panel)', () => {
  it('creates an empty "Region 1" with the first palette colour, without painting', () => {
    const store = new EditorStore();

    const id = store.newRegion();

    const regions = store.document().regions;
    expect(regions).toHaveLength(1);
    expect(regions[0].id).toBe(id);
    expect(regions[0].name).toBe('Region 1');
    expect(regions[0].color).toBe('#7c9b86');
    // "without painting": the new Region starts with no member hexes (the panel
    // lists it as an empty, canvas-invisible Region).
    expect(regions[0].hexes).toEqual({});
  });

  it('selects the new Region and opens it in the Inspector, even from the list', () => {
    const store = new EditorStore();
    store.showRegionsPanel(); // the user is on the Regions list when they click New

    const id = store.newRegion();

    // The fresh Region is selected so the Inspector opens on it to be named, and the
    // shared column flips from the list back to the Inspector to show that editor.
    expect(store.selection()).toEqual({ kind: 'region', id });
    expect(store.rightPanel()).toBe('inspector');
  });

  it('arms the Region tool on the new Region in Add, so the next stroke paints into it', () => {
    const store = new EditorStore();

    const id = store.newRegion();

    // A freshly-created Region is ready to receive hexes: the Region membership brush
    // is armed on it in Add (issue #39, ADR-0012). No hex is painted yet.
    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id, mode: 'add' });
    expect(store.regionDirection()).toBe('add');
    expect(store.document().regions[0].hexes).toEqual({});
  });

  it('creates as one undoable step that restores name, selection on redo', () => {
    const store = new EditorStore();

    const id = store.newRegion();

    store.undo(); // one undo removes the new Region and clears its selection
    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();

    store.redo(); // redo brings it back, selected
    expect(store.document().regions[0].name).toBe('Region 1');
    expect(store.selection()).toEqual({ kind: 'region', id });
  });

  it('numbers and colours successive New Regions through the palette in order', () => {
    const store = new EditorStore();

    store.newRegion(); // Region 1
    store.newRegion(); // Region 2

    const regions = store.document().regions;
    expect(regions.map((r) => r.name)).toEqual(['Region 1', 'Region 2']);
    expect(regions.map((r) => r.color)).toEqual(['#7c9b86', '#b08a4e']);
  });

  it('numbers a New Region by the next unused "Region N", not the region count', () => {
    const store = new EditorStore();

    store.newRegion(); // Region 1
    store.newRegion(); // Region 2
    store.deleteRegion(store.document().regions[0].id); // delete Region 1
    store.newRegion(); // mints again

    // "Region 1" is free again, but the next number is max(existing)+1 = 3, so a
    // name/colour freed by a deletion is not immediately reused.
    expect(store.document().regions.map((r) => r.name)).toEqual([
      'Region 2',
      'Region 3',
    ]);
  });
});

describe('EditorStore shared right column', () => {
  it('is closed by default and opens the Regions list on demand', () => {
    const store = new EditorStore();

    // The right panel is closed by default (ADR-0013): nothing covers the map until
    // there is something to show — a selection (Inspector) or Regions toggled on.
    expect(store.rightPanel()).toBeNull();

    store.showRegionsPanel();

    expect(store.rightPanel()).toBe('regions');
  });

  it('selects a Region by id — even an empty one — and flips back to the Inspector', () => {
    const store = new EditorStore();
    // An empty Region has no member hex, so it cannot be reached by select(coord);
    // selecting it from the list must go by id. This is the "emptied Regions stay
    // reachable" case the Regions panel must support (ADR-0011).
    const id = store.createRegion('The Whisperwood', '#6f7fae');
    store.showRegionsPanel();

    store.selectRegion(id);

    expect(store.selection()).toEqual({ kind: 'region', id });
    expect(store.selectedRegion()?.name).toBe('The Whisperwood');
    expect(store.rightPanel()).toBe('inspector');
  });

  it('resets the right panel closed when a map is opened', () => {
    const store = new EditorStore();
    store.showRegionsPanel();

    // Opening a map is a fresh start (like the tool and selection reset in load), so
    // the reopened map shows a clear right side — closed, not the previous session's
    // list view, and not an empty Inspector (ADR-0013, story 20).
    store.load(emptyHexMap());

    expect(store.rightPanel()).toBeNull();
  });

  it('flips the shared column back to the Inspector when a canvas selection is made', () => {
    const store = new EditorStore();
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 }); // a member coordinate to click
    store.showRegionsPanel(); // the user is on the Regions list
    expect(store.rightPanel()).toBe('regions');

    // A canvas selection opens the picked entity for editing, so the shared column
    // flips back to the Inspector (the _rightPanel contract, issue #39).
    store.select({ q: 0, r: 0 }, null);

    expect(store.rightPanel()).toBe('inspector');
    expect(store.selection()).toEqual({ kind: 'region', id });
  });

  it('flips the shared column back to the Inspector when a Label is selected', () => {
    const store = new EditorStore();
    const id = store.addLabel('Pick me', { x: 0, y: 0 });
    store.showRegionsPanel();
    expect(store.rightPanel()).toBe('regions');

    store.selectLabel(id);

    expect(store.rightPanel()).toBe('inspector');
    expect(store.selectedLabel()?.id).toBe(id);
  });

  it('disarms a membership brush armed on a different Region when one is selected from the list', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    const b = store.createRegion('Brevoy', '#7c9b86');
    store.armRegion(a, 'add'); // the brush is armed on A
    expect(store.tool()).toBe('region');

    // Selecting a *different* Region B from the list must disarm the stale brush, so
    // the next canvas stroke does not silently paint into B (the brush is armed only
    // via the Inspector's Add/Remove, ADR-0012).
    store.selectRegion(b);

    expect(store.tool()).toBe('select');
    expect(store.region()).toBeNull();

    // A subsequent stroke paints nothing into B (the tool is Select, a no-op).
    store.applyAt({ q: 2, r: 2 });
    expect(store.document().regions.find((r) => r.id === b)?.hexes).toEqual({});
  });

  it('leaves the brush armed when the Region it targets is the one selected', () => {
    const store = new EditorStore();
    const a = store.createRegion('Avalon', '#b08a4e');
    store.armRegion(a, 'remove'); // armed on A…

    store.selectRegion(a); // …and A is the one being selected, so the brush stays

    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id: a, mode: 'remove' });
  });

  it('toggles the right panel between the Regions list and closed', () => {
    const store = new EditorStore();

    // The panel is closed by default; the rail entry's click opens the Regions list.
    expect(store.rightPanel()).toBeNull();

    store.toggleRegionsPanel();
    expect(store.rightPanel()).toBe('regions');

    // Clicking the active entry again closes the panel — its off-state is closed,
    // not the Inspector (ADR-0013, story 18).
    store.toggleRegionsPanel();
    expect(store.rightPanel()).toBeNull();
  });

  it('opens the Inspector from the closed default when an entity is selected', () => {
    const store = new EditorStore();
    store.paintAt({ q: 0, r: 0 }, 'forest');
    expect(store.rightPanel()).toBeNull(); // closed boot state

    // Selecting an entity opens the Inspector so it can be edited (story 16) — the
    // selection-opens-for-editing contract holds even when the panel was closed.
    store.select({ q: 0, r: 0 }, null);

    expect(store.rightPanel()).toBe('inspector');
  });

  it('opens the Regions list from the Inspector when the rail entry is toggled', () => {
    const store = new EditorStore();
    const id = store.addLabel('Pick me', { x: 0, y: 0 });
    store.selectLabel(id); // a selection opens the Inspector
    expect(store.rightPanel()).toBe('inspector');

    // Toggling Regions while the Inspector is open switches to the list (the
    // toggle's on-state is `regions` regardless of what the panel currently shows).
    store.toggleRegionsPanel();
    expect(store.rightPanel()).toBe('regions');
  });

  it('closes the Inspector when the selection that opened it is cleared', () => {
    const store = new EditorStore();
    const id = store.addLabel('Pick me', { x: 0, y: 0 });
    store.selectLabel(id); // a selection opens the Inspector
    expect(store.rightPanel()).toBe('inspector');

    // Clearing the selection reclaims the map: the Inspector only floats while it
    // has a selection to show, so a deselect closes it — the mirror of the
    // selection that opened it (ADR-0013, story 20). Nothing left covering the map.
    store.deselect();

    expect(store.rightPanel()).toBeNull();
  });

  it('closes the Inspector when the inspected entity is deleted', () => {
    const store = new EditorStore();
    const id = store.addLabel('Doomed', { x: 0, y: 0 });
    store.selectLabel(id);
    expect(store.rightPanel()).toBe('inspector');

    // Deleting the inspected entity clears the selection (the deletion paths route
    // through deselect), so the panel returns to closed rather than stranding an
    // empty-state Inspector over the map.
    store.deleteSelected();

    expect(store.rightPanel()).toBeNull();
  });

  it('leaves the Regions list open when a canvas click deselects', () => {
    const store = new EditorStore();
    store.showRegionsPanel();
    expect(store.rightPanel()).toBe('regions');

    // A Void-coordinate click deselects, but the Regions list is not selection-driven
    // (the user opened it via the rail), so it stays open — only the Inspector closes
    // on deselect.
    store.select({ q: 9, r: 9 }, null);

    expect(store.rightPanel()).toBe('regions');
  });
});
