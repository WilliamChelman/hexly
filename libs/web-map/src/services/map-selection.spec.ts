import { signal, WritableSignal } from '@angular/core';
import { coordKey, emptyHexMap, HexMap } from '@hexly/domain';
import { MapSelection } from './map-selection';

/**
 * Unit tests for the {@link MapSelection} module in isolation — no store, no TestBed.
 * A plain document `signal` stands in for the live map, so a test can mutate the
 * document under the selection to exercise the self-heal that used to be reachable
 * only through the whole {@link HexMapStore}. The store spec keeps covering the
 * façade + orchestration (panel projection, brush disarm, undo/redo lockstep).
 */

/** Build a document signal from partial pieces; keys are `coordKey`s. */
function makeDoc(parts: Partial<HexMap> = {}): WritableSignal<HexMap> {
  return signal<HexMap>({ ...emptyHexMap(), ...parts });
}

const at = (q: number, r: number) => ({ q, r });

describe('MapSelection', () => {
  describe('select precedence (plain click)', () => {
    it('a Label hit wins over the cell and regions beneath it', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
        regions: [
          {
            id: 'reg',
            name: 'R',
            color: '#fff',
            hexes: { [coordKey(at(0, 0))]: true },
          },
        ],
        labels: [{ id: 'lbl', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), 'lbl');

      expect(sel.selection()).toEqual({ kind: 'label', id: 'lbl' });
    });

    it('selects the painted cell when there is no label hit', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(1, 1))]: { terrain: 'ocean' } },
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(1, 1), null);

      expect(sel.selection()).toEqual({ kind: 'hex', coord: at(1, 1) });
    });

    it('reads a cell carrying a feature as a feature selection', () => {
      const doc = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: {
            terrain: 'forest',
            feature: { ref: 'settlement' },
          },
        },
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), null);

      expect(sel.selection()).toEqual({ kind: 'feature', coord: at(0, 0) });
    });

    it('a plain click on Void with no label hit clears the selection', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.select(at(0, 0), null);

      sel.select(at(9, 9), null);

      expect(sel.selection()).toBeNull();
      expect(sel.selections()).toEqual([]);
    });
  });

  describe('click-cycle', () => {
    it('descends Label → Feature → Region(s) → wrap on repeated clicks at one anchor', () => {
      const doc = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: {
            terrain: 'forest',
            feature: { ref: 'settlement' },
          },
        },
        regions: [
          {
            id: 'r1',
            name: 'R1',
            color: '#111',
            hexes: { [coordKey(at(0, 0))]: true },
          },
          {
            id: 'r2',
            name: 'R2',
            color: '#222',
            hexes: { [coordKey(at(0, 0))]: true },
          },
        ],
        labels: [{ id: 'lbl', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());

      const kinds: string[] = [];
      for (let i = 0; i < 5; i++) {
        sel.select(at(0, 0), 'lbl');
        kinds.push(sel.selection()?.kind ?? 'none');
      }

      // label, feature, region, region, then wrap back to label
      expect(kinds).toEqual(['label', 'feature', 'region', 'region', 'label']);
    });

    it('a click at a different anchor restarts at the top of the new stack', () => {
      const doc = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: {
            terrain: 'forest',
            feature: { ref: 'settlement' },
          },
          [coordKey(at(5, 5))]: { terrain: 'ocean' },
        },
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), null); // feature
      sel.select(at(5, 5), null); // different anchor → top of its stack

      expect(sel.selection()).toEqual({ kind: 'hex', coord: at(5, 5) });
    });
  });

  describe('modifier folds', () => {
    it('toggle-top adds then removes the topmost entity', () => {
      const doc = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: { terrain: 'forest' },
          [coordKey(at(1, 0))]: { terrain: 'ocean' },
        },
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), null);
      sel.select(at(1, 0), null, 'toggle-top');
      expect(sel.selections()).toHaveLength(2);

      sel.select(at(1, 0), null, 'toggle-top');
      expect(sel.selections()).toEqual([{ kind: 'hex', coord: at(0, 0) }]);
    });

    it('toggle-stack removes the whole pile when it is already fully selected', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
        regions: [
          {
            id: 'r1',
            name: 'R1',
            color: '#111',
            hexes: { [coordKey(at(0, 0))]: true },
          },
        ],
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), null, 'toggle-stack'); // adds hex + region
      expect(sel.selections()).toHaveLength(2);

      sel.select(at(0, 0), null, 'toggle-stack'); // second toggle clears the pile
      expect(sel.selections()).toEqual([]);
    });

    it('add-stack (modifier-held sweep) never removes a re-entered member', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
        regions: [
          {
            id: 'r1',
            name: 'R1',
            color: '#111',
            hexes: { [coordKey(at(0, 0))]: true },
          },
        ],
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), null, 'add-stack');
      const after1 = sel.selections().length;
      sel.select(at(0, 0), null, 'add-stack'); // re-enter mid-sweep

      expect(sel.selections()).toHaveLength(after1); // unchanged, nothing removed
    });

    it('a modifier click on empty space leaves the existing set untouched', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.select(at(0, 0), null);

      sel.select(at(9, 9), null, 'toggle-top'); // modifier on Void

      expect(sel.selections()).toEqual([{ kind: 'hex', coord: at(0, 0) }]);
    });
  });

  describe('marquee', () => {
    const doc = () =>
      makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: { terrain: 'forest' },
          [coordKey(at(1, 0))]: { terrain: 'ocean' },
        },
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });

    it('a plain marquee replaces the set with the box contents', () => {
      const sel = new MapSelection(doc().asReadonly());
      sel.select(at(0, 0), null);

      sel.marqueeSelect([at(1, 0)], ['l1'], false);

      expect(sel.selections()).toHaveLength(2);
      expect(sel.selections().some((s) => s.kind === 'label' && s.id === 'l1')).toBe(true);
    });

    it('marqueePreview matches what a commit of the same box produces', () => {
      const selA = new MapSelection(doc().asReadonly());
      const selB = new MapSelection(doc().asReadonly());

      const preview = selA.marqueePreview([at(0, 0), at(1, 0)], ['l1'], false);
      selB.marqueeSelect([at(0, 0), at(1, 0)], ['l1'], false);

      expect(preview).toEqual(selB.selections());
    });

    it('an additive marquee previews the committed set unioned with the box', () => {
      const sel = new MapSelection(doc().asReadonly());
      sel.marqueeSelect([at(0, 0)], [], false);

      const preview = sel.marqueePreview([at(1, 0)], [], true);

      expect(preview).toHaveLength(2);
    });
  });

  describe('self-heal against the live document', () => {
    it('drops a selected hex from selections() when its record is erased', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.select(at(0, 0), null);

      doc.set({ ...doc(), hexes: {} }); // erase under the selection

      expect(sel.selections()).toEqual([]);
      expect(sel.selection()).toBeNull();
    });

    it('selectedLabel/Region resolve to null once the entity is gone', () => {
      const doc = makeDoc({
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.selectLabel('l1');
      expect(sel.selectedLabel()).not.toBeNull();

      doc.set({ ...doc(), labels: [] });

      expect(sel.selectedLabel()).toBeNull();
      expect(sel.selection()).toBeNull();
    });
  });

  describe('selectedEntityLink', () => {
    it('reads the link off a hex, a feature, and a region', () => {
      const linkHex = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: { terrain: 'forest', entityId: 'e-hex' },
        },
      });
      const sHex = new MapSelection(linkHex.asReadonly());
      sHex.select(at(0, 0), null);
      expect(sHex.selectedEntityLink()).toBe('e-hex');

      const linkFeat = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: {
            terrain: 'forest',
            feature: { ref: 'settlement', entityId: 'e-feat' },
          },
        },
      });
      const sFeat = new MapSelection(linkFeat.asReadonly());
      sFeat.select(at(0, 0), null);
      expect(sFeat.selectedEntityLink()).toBe('e-feat');

      const linkReg = makeDoc({
        regions: [{ id: 'r1', name: 'R', color: '#111', hexes: {}, entityId: 'e-reg' }],
      });
      const sReg = new MapSelection(linkReg.asReadonly());
      sReg.selectRegion('r1');
      expect(sReg.selectedEntityLink()).toBe('e-reg');
    });
  });

  describe('history seam (snapshot / restore)', () => {
    it('restores a snapshotted reference set verbatim', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(2, 2))]: { terrain: 'forest' } },
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.selectLabel('l1');
      const snap = sel.snapshot();

      sel.deselect();
      expect(sel.selections()).toEqual([]);
      sel.restore(snap);

      expect(sel.selection()).toEqual({ kind: 'label', id: 'l1' });
    });

    it('restore resets the cycle anchor so the next click starts at the top', () => {
      const doc = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: {
            terrain: 'forest',
            feature: { ref: 'settlement' },
          },
        },
        regions: [
          {
            id: 'r1',
            name: 'R1',
            color: '#111',
            hexes: { [coordKey(at(0, 0))]: true },
          },
        ],
      });
      const sel = new MapSelection(doc.asReadonly());

      sel.select(at(0, 0), null); // feature (top)
      sel.select(at(0, 0), null); // cycles to region
      expect(sel.selection()).toEqual({ kind: 'region', id: 'r1' });

      sel.restore(sel.snapshot()); // same refs, but anchor forgotten
      sel.select(at(0, 0), null); // a fresh cycle: back to the top

      expect(sel.selection()).toEqual({ kind: 'feature', coord: at(0, 0) });
    });
  });

  describe('move seam', () => {
    it('partitionForMove splits the set into hexes, labels, regions', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
        regions: [
          {
            id: 'r1',
            name: 'R',
            color: '#111',
            hexes: { [coordKey(at(0, 0))]: true },
          },
        ],
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.marqueeSelect([at(0, 0)], ['l1'], false);
      sel.select(at(0, 0), null, 'toggle-stack'); // fold the region in too

      const parts = sel.partitionForMove();

      expect(parts.hexes).toEqual([at(0, 0)]);
      expect(parts.labels).toEqual(['l1']);
      expect(parts.regions).toEqual(['r1']);
    });

    it('repointByOffset rides cell refs by the offset and leaves label/region refs put', () => {
      const doc = makeDoc({
        hexes: {
          [coordKey(at(0, 0))]: { terrain: 'forest' },
          [coordKey(at(1, 1))]: { terrain: 'ocean' },
        },
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.marqueeSelect([at(0, 0)], ['l1'], false);

      sel.repointByOffset(at(1, 1));

      // The cell ref moved to (1,1) — which exists — and the label ref is unchanged.
      expect(sel.selections().some((s) => s.kind === 'hex' && s.coord.q === 1 && s.coord.r === 1)).toBe(true);
      expect(sel.selections().some((s) => s.kind === 'label' && s.id === 'l1')).toBe(true);
    });
  });

  describe('dropWhere', () => {
    it('removes matching members and keeps the rest', () => {
      const doc = makeDoc({
        hexes: { [coordKey(at(0, 0))]: { terrain: 'forest' } },
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.marqueeSelect([at(0, 0)], ['l1'], false);

      sel.dropWhere((ref) => ref.kind === 'label' && ref.id === 'l1');

      expect(sel.selections()).toEqual([{ kind: 'hex', coord: at(0, 0) }]);
    });

    it('emptying the set clears it entirely', () => {
      const doc = makeDoc({
        labels: [{ id: 'l1', text: 'x', position: { x: 0, y: 0 }, size: 10 }],
      });
      const sel = new MapSelection(doc.asReadonly());
      sel.selectLabel('l1');

      sel.dropWhere((ref) => ref.kind === 'label' && ref.id === 'l1');

      expect(sel.selections()).toEqual([]);
    });
  });
});
