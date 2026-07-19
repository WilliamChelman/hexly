import { TestBed } from '@angular/core/testing';
import { BoardElement, BoardSurface, emptyBoardSurface } from '@hexly/plugin-board';
import { BoardStore } from './board-store';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';

let session: FakeEntitySession;

beforeEach(() => {
  // Binds the store to `core.board`'s own `core.surface` Field, as the entity page's outlet does.
  TestBed.configureTestingModule({ providers: provideBoardStoreTesting() });
  session = TestBed.inject(FakeEntitySession);
});

function makeStore(): BoardStore {
  return TestBed.inject(BoardStore);
}

function reload(surface: BoardSurface): void {
  session.load(surface);
  TestBed.flushEffects();
}

/** A minimal well-formed Text Block element for driving commits. */
function textElement(id: string, x: number): BoardElement {
  return {
    id,
    kind: 'text',
    position: { x, y: 0 },
    size: { width: 200, height: 100 },
    z: 0,
    content: { format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } },
  };
}

/** The element ids in bottom→top stacking order. */
function stackOrder(store: BoardStore): string[] {
  return [...store.document().elements].sort((a, b) => a.z - b.z).map((e) => e.id);
}

/** Add three boxes a, b, c (c on top) and return their ids. */
function addThreeBoxes(store: BoardStore): [string, string, string] {
  const a = store.addElement({ x: 0, y: 0 });
  const b = store.addElement({ x: 50, y: 0 });
  const c = store.addElement({ x: 100, y: 0 });
  return [a, b, c];
}

describe('BoardStore', () => {
  it('opens on an empty plane when the surface is absent', () => {
    const store = makeStore();

    expect(store.document()).toEqual(emptyBoardSurface());
  });

  it('renders the surface the session holds', () => {
    const store = makeStore();
    const surface: BoardSurface = { elements: [textElement('a', 10)] };

    reload(surface);

    expect(store.document().elements).toHaveLength(1);
    expect(store.document().elements[0].id).toBe('a');
  });

  it('opens a document it cannot parse as an empty plane rather than erroring', () => {
    const store = makeStore();

    session.loadRawSurface({ elements: 'not-an-array' });
    TestBed.flushEffects();

    expect(store.document()).toEqual(emptyBoardSurface());
  });

  it('commits an edit through Immer, leaving the previous document untouched', () => {
    const store = makeStore();
    const before = store.document();

    store.commit((draft) => draft.elements.push(textElement('a', 0)));

    expect(store.document()).not.toBe(before);
    expect(before.elements).toEqual([]);
    expect(store.document().elements[0].id).toBe('a');
  });

  it('replaces an unstored plane in the same mutation as the edit that provoked it', () => {
    const store = makeStore();
    // Nothing at the key yet — the store shows an empty plane the first commit must persist.
    store.commit((draft) => draft.elements.push(textElement('a', 0)));

    expect(store.document().elements).toHaveLength(1);
  });

  it('undo reverses a commit', () => {
    const store = makeStore();
    store.commit((draft) => draft.elements.push(textElement('a', 0)));

    store.undo();

    expect(store.document().elements).toEqual([]);
  });

  it('redo re-applies an undone commit', () => {
    const store = makeStore();
    store.commit((draft) => draft.elements.push(textElement('a', 0)));
    store.undo();

    store.redo();

    expect(store.document().elements[0].id).toBe('a');
  });

  it('drops the redo branch once a new edit is made', () => {
    const store = makeStore();
    store.commit((draft) => draft.elements.push(textElement('a', 0)));
    store.undo();

    store.commit((draft) => draft.elements.push(textElement('b', 50)));
    store.redo();

    expect(store.document().elements.map((e) => e.id)).toEqual(['b']);
  });

  it('reports nothing to undo or redo on a fresh surface, and ignores both', () => {
    const store = makeStore();

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(() => {
      store.undo();
      store.redo();
    }).not.toThrow();
    expect(store.document()).toEqual(emptyBoardSurface());
  });

  it('tracks undo/redo availability as edits flow', () => {
    const store = makeStore();
    store.commit((draft) => draft.elements.push(textElement('a', 0)));

    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);

    store.undo();

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it('records no undo step for a commit that changes nothing', () => {
    const store = makeStore();

    const recorded = store.commit(() => {
      /* no mutation */
    });

    expect(recorded).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('clears the undo history on a fresh load', () => {
    const store = makeStore();
    store.commit((draft) => draft.elements.push(textElement('a', 0)));

    reload({ elements: [] });

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });
});

describe('BoardStore tool arming', () => {
  it('opens armed with Select so the first gesture is non-destructive', () => {
    expect(makeStore().tool()).toBe('select');
  });

  it('arms exactly one Tool at a time', () => {
    const store = makeStore();
    store.armTool('box');
    expect(store.tool()).toBe('box');
    store.armTool('select');
    expect(store.tool()).toBe('select');
  });

  it('re-arms Select on a fresh load', () => {
    const store = makeStore();
    store.armTool('box');
    reload({ elements: [] });
    expect(store.tool()).toBe('select');
  });
});

describe('BoardStore element operations', () => {
  it('adds the minimal Box element on top and selects it, returning on-top z', () => {
    const store = makeStore();
    const a = store.addElement({ x: 10, y: 20 });
    const b = store.addElement({ x: 30, y: 40 });

    const elements = store.document().elements;
    expect(elements.map((e) => e.id)).toEqual([a, b]);
    expect(elements.every((e) => e.kind === 'box')).toBe(true);
    // Newly added element lands on top, and is the current selection.
    expect(elements[1].z).toBeGreaterThan(elements[0].z);
    expect(store.selectedElement()?.id).toBe(b);
    expect(store.document().elements[1].position).toEqual({ x: 30, y: 40 });
  });

  it('moves a single element to a new position', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.move(a, { x: 5, y: 7 });
    expect(store.document().elements[0].position).toEqual({ x: 5, y: 7 });
  });

  it('resizes a single element, refusing a non-positive size', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.resize(a, { width: 300, height: 200 });
    expect(store.document().elements[0].size).toEqual({ width: 300, height: 200 });

    store.resize(a, { width: 0, height: 200 });
    expect(store.document().elements[0].size).toEqual({ width: 300, height: 200 });
    store.resize(a, { width: -1, height: 200 });
    expect(store.document().elements[0].size).toEqual({ width: 300, height: 200 });
  });

  it('sets position and size together in one undo step (resize-drag path)', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });

    store.setGeometry(a, { x: -20, y: -10 }, { width: 200, height: 140 });

    const element = store.document().elements[0];
    expect(element.position).toEqual({ x: -20, y: -10 });
    expect(element.size).toEqual({ width: 200, height: 140 });

    store.undo();
    // One step restores both, not just one of the two.
    expect(store.document().elements[0].position).toEqual({ x: 0, y: 0 });
    expect(store.document().elements[0].size).toEqual({ width: 160, height: 120 });
  });

  it('moves the whole selection together by a delta, in one undo step', () => {
    const store = makeStore();
    const [a, b] = addThreeBoxes(store);
    store.selectMany([a, b]);

    const before = store.document();
    const moved = store.moveSelected({ x: 10, y: -5 });

    expect(moved).toBe(true);
    const byId = new Map(store.document().elements.map((e) => [e.id, e]));
    expect(byId.get(a)?.position).toEqual({ x: 10, y: -5 });
    expect(byId.get(b)?.position).toEqual({ x: 60, y: -5 });
    // c was not selected, so it stays.
    expect(byId.get(store.document().elements[2].id)?.position).toEqual({ x: 100, y: 0 });

    store.undo();
    expect(store.document()).toEqual(before);
  });

  it('reports no move for an empty selection or a zero delta', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.deselect();
    expect(store.moveSelected({ x: 5, y: 5 })).toBe(false); // nothing selected
    store.select(a);
    expect(store.moveSelected({ x: 0, y: 0 })).toBe(false); // zero delta
  });

  it('deletes the whole selection in one undo step, clearing it', () => {
    const store = makeStore();
    const [a, b, c] = addThreeBoxes(store);
    store.selectMany([a, b]);

    store.delete();

    expect(store.document().elements.map((e) => e.id)).toEqual([c]);
    expect(store.selectedIds()).toEqual([]);

    store.undo();
    expect(store.document().elements.map((e) => e.id)).toEqual([a, b, c]);
    // Undo restores the selection the deletion was made under.
    expect(new Set(store.selectedIds())).toEqual(new Set([a, b]));
  });

  it('deletes a single element regardless of selection', () => {
    const store = makeStore();
    const [a, b] = addThreeBoxes(store);
    store.select(a);
    store.deleteElement(b);
    expect(store.document().elements.map((e) => e.id)).not.toContain(b);
    // a stays selected.
    expect(store.selectedElement()?.id).toBe(a);
  });
});

describe('BoardStore z-order', () => {
  it('brings an element forward one step, and no-ops at the top', () => {
    const store = makeStore();
    const [a, b, c] = addThreeBoxes(store);
    store.bringForward(a);
    expect(stackOrder(store)).toEqual([b, a, c]);
    store.bringForward(c); // already on top
    expect(stackOrder(store)).toEqual([b, a, c]);
  });

  it('sends an element backward one step, and no-ops at the bottom', () => {
    const store = makeStore();
    const [a, b, c] = addThreeBoxes(store);
    store.sendBackward(c);
    expect(stackOrder(store)).toEqual([a, c, b]);
    store.sendBackward(a); // already at the bottom
    expect(stackOrder(store)).toEqual([a, c, b]);
  });

  it('brings an element to the very front and sends one to the very back', () => {
    const store = makeStore();
    const [a, b, c] = addThreeBoxes(store);
    store.toFront(a);
    expect(stackOrder(store)).toEqual([b, c, a]);
    store.toBack(a);
    expect(stackOrder(store)).toEqual([a, b, c]);
  });

  it('records no undo step for a reorder that changes nothing (unknown id)', () => {
    const store = makeStore();
    addThreeBoxes(store);
    const undoBefore = store.canUndo();
    store.bringForward('missing');
    // canUndo is unchanged — the pure helper no-oped, so commit recorded nothing.
    expect(store.canUndo()).toBe(undoBefore);
  });

  it('renumbers z to a dense 0-based sequence after a reorder', () => {
    const store = makeStore();
    const [a] = addThreeBoxes(store);
    store.toFront(a);
    expect(
      store
        .document()
        .elements.map((e) => e.z)
        .sort((x, y) => x - y),
    ).toEqual([0, 1, 2]);
  });
});

describe('BoardStore element arming', () => {
  it('arms at most one element at a time', () => {
    const store = makeStore();
    const [a, b] = addThreeBoxes(store);
    store.arm(a);
    expect(store.armed()).toBe(a);
    store.arm(b);
    expect(store.armed()).toBe(b);
    store.disarm();
    expect(store.armed()).toBeNull();
  });

  it('never writes the armed element or selection into the surface document', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.arm(a);
    store.select(a);
    // The surface holds only the element geometry/z-order — no selection or armed flag.
    expect(store.document()).toEqual({
      elements: [{ id: a, kind: 'box', position: { x: 0, y: 0 }, size: { width: 160, height: 120 }, z: 0 }],
    });
  });

  it('disarms an armed element when the selection moves off it', () => {
    const store = makeStore();
    const [a, b] = addThreeBoxes(store);
    store.select(a);
    store.arm(a);
    store.select(b);
    expect(store.armed()).toBeNull();
  });

  it('disarms an armed element when it is deleted', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.select(a);
    store.arm(a);
    store.delete();
    expect(store.armed()).toBeNull();
  });

  it('clears tool, selection, and armed element on a fresh load', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.arm(a);
    store.armTool('box');
    reload({ elements: [] });
    expect(store.tool()).toBe('select');
    expect(store.selectedIds()).toEqual([]);
    expect(store.armed()).toBeNull();
  });
});
