import { TestBed } from '@angular/core/testing';
import {
  BoardElement,
  BoardSurface,
  EmbedElement,
  emptyBoardSurface,
  ImageElement,
  TextElement,
} from '@hexly/plugin-board';
import { emptyContent, tiptapContent } from '@hexly/plugin-content';
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

  it('refuses a non-finite position, recording no undo step (a bad inspector entry)', () => {
    const store = makeStore();
    const a = store.addElement({ x: 5, y: 7 });
    const undoBefore = store.canUndo();

    // `Number('1e400') === Infinity`, which serializes to `null` and fails the reload parse (whole-board
    // loss) — the store rejects it before it can reach the document, symmetric with the size guard.
    store.move(a, { x: Infinity, y: 0 });
    expect(store.document().elements[0].position).toEqual({ x: 5, y: 7 });
    expect(store.canUndo()).toBe(undoBefore);

    store.setGeometry(a, { x: Number.NaN, y: 0 }, { width: 50, height: 50 });
    expect(store.document().elements[0].position).toEqual({ x: 5, y: 7 });
    expect(store.canUndo()).toBe(undoBefore);
  });

  it('refuses a non-finite delta for the whole selection', () => {
    const store = makeStore();
    const a = store.addElement({ x: 0, y: 0 });
    store.select(a);
    expect(store.moveSelected({ x: Infinity, y: 0 })).toBe(false);
    expect(store.document().elements[0].position).toEqual({ x: 0, y: 0 });
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

describe('BoardStore Text Block', () => {
  it('adds a Text Block: an empty core.rich-content element on top, selected and armed to type into', () => {
    const store = makeStore();
    const box = store.addElement({ x: 0, y: 0 });
    const id = store.addText({ x: 20, y: 30 });

    const element = store.document().elements.find((e) => e.id === id) as TextElement | undefined;
    expect(element?.kind).toBe('text');
    expect(element?.position).toEqual({ x: 20, y: 30 });
    // The same empty `core.rich-content` value an Entity's Content opens on.
    expect(element?.content).toEqual(emptyContent());
    // Lands above the pre-existing box.
    const boxZ = store.document().elements.find((e) => e.id === box)?.z ?? 0;
    expect(element?.z).toBeGreaterThan(boxZ);
    // Selected and armed so the author writes in it at once (the first inline-edit consumer of arm/disarm).
    expect(store.selectedElement()?.id).toBe(id);
    expect(store.armed()).toBe(id);
  });

  it('commits new prose into a Text Block as one undoable step', () => {
    const store = makeStore();
    const id = store.addText({ x: 0, y: 0 });
    const prose = tiptapContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hail' }] }],
    });

    store.setContent(id, prose);
    expect((store.document().elements[0] as TextElement).content).toEqual(prose);

    store.undo();
    expect((store.document().elements[0] as TextElement).content).toEqual(emptyContent());
  });

  it('ignores setContent for a missing element or a non-text kind — records no undo step', () => {
    const store = makeStore();
    const box = store.addElement({ x: 0, y: 0 });
    const before = store.document();

    store.setContent(box, tiptapContent({ type: 'doc', content: [] }));
    store.setContent('missing', tiptapContent({ type: 'doc', content: [] }));

    // No commit fired, so the document reference is untouched.
    expect(store.document()).toBe(before);
  });
});

describe('BoardStore Image', () => {
  // Both Image sources — uploading a file and picking an existing Asset — resolve to a served capability
  // URL the UI hands to addImage; from the store's view they are one path, so these drive it with a URL.
  const UPLOADED_URL = '/assets/w1/aaa.png';
  const PICKED_URL = '/assets/w1/bbb.jpg';

  it('adds an Image from an uploaded Asset on top, at the clicked geometry, and selects it', () => {
    const store = makeStore();
    const box = store.addElement({ x: 0, y: 0 });
    const id = store.addImage({ x: 40, y: 60 }, UPLOADED_URL);

    const element = store.document().elements.find((e) => e.id === id) as ImageElement | undefined;
    expect(element?.kind).toBe('image');
    expect(element?.assetUrl).toBe(UPLOADED_URL);
    expect(element?.position).toEqual({ x: 40, y: 60 });
    expect(element?.size).toEqual({ width: 240, height: 180 });
    // Lands above the pre-existing box, and is the current selection.
    const boxZ = store.document().elements.find((e) => e.id === box)?.z ?? 0;
    expect(element?.z).toBeGreaterThan(boxZ);
    expect(store.selectedElement()?.id).toBe(id);
  });

  it('adds an Image from a picked existing Asset the same way (both sources funnel through addImage)', () => {
    const store = makeStore();
    const id = store.addImage({ x: 5, y: 5 }, PICKED_URL);

    const element = store.document().elements.find((e) => e.id === id) as ImageElement | undefined;
    expect(element?.kind).toBe('image');
    expect(element?.assetUrl).toBe(PICKED_URL);
  });

  it('never arms an Image — it is always static, so a click only ever selects/moves it', () => {
    const store = makeStore();
    const id = store.addImage({ x: 0, y: 0 }, UPLOADED_URL);
    // Unlike a Text Block, adding an Image leaves nothing armed.
    expect(store.armed()).toBeNull();
    // Selecting it (the click path) still arms nothing.
    store.select(id);
    expect(store.armed()).toBeNull();
  });

  it('moves and resizes an Image like any element, and drops it on undo', () => {
    const store = makeStore();
    const id = store.addImage({ x: 0, y: 0 }, UPLOADED_URL);

    store.move(id, { x: 12, y: 34 });
    store.resize(id, { width: 320, height: 200 });
    const element = store.document().elements[0] as ImageElement;
    expect(element.position).toEqual({ x: 12, y: 34 });
    expect(element.size).toEqual({ width: 320, height: 200 });

    store.deleteElement(id);
    expect(store.document().elements).toEqual([]);
    store.undo();
    expect((store.document().elements[0] as ImageElement).assetUrl).toBe(UPLOADED_URL);
  });

  it('starts an Image with its aspect-ratio lock off', () => {
    const store = makeStore();
    const id = store.addImage({ x: 0, y: 0 }, UPLOADED_URL);
    expect((store.document().elements.find((e) => e.id === id) as ImageElement).lockRatio).toBe(false);
  });

  it('toggles the aspect-ratio lock through setLockRatio, as one undoable step', () => {
    const store = makeStore();
    const id = store.addImage({ x: 0, y: 0 }, UPLOADED_URL);

    store.setLockRatio(id, true);
    expect((store.document().elements[0] as ImageElement).lockRatio).toBe(true);

    store.undo();
    expect((store.document().elements[0] as ImageElement).lockRatio).toBe(false);
  });

  it('setLockRatio is a no-op (no undo step) for a non-image element', () => {
    const store = makeStore();
    const box = store.addElement({ x: 0, y: 0 });
    const undoBefore = store.canUndo();
    store.setLockRatio(box, true);
    // The box grew no spurious field, and the stray call recorded nothing to undo.
    expect(store.canUndo()).toBe(undoBefore);
    expect((store.document().elements[0] as Record<string, unknown>)['lockRatio']).toBeUndefined();
  });
});

describe('BoardStore Embed elements', () => {
  it('adds an Embed targeting an Entity and the chosen View, on top and selected', () => {
    const store = makeStore();
    const box = store.addElement({ x: 0, y: 0 });
    const id = store.addEmbed({ x: 40, y: 40 }, 'note-1', 'core.view.map:core.grid');

    const element = store.document().elements.find((e) => e.id === id) as EmbedElement | undefined;
    expect(element?.kind).toBe('embed');
    expect(element?.targetEntityId).toBe('note-1');
    expect(element?.viewInstance).toBe('core.view.map:core.grid');
    // Lands above the pre-existing box, and is the current selection.
    const boxZ = store.document().elements.find((e) => e.id === box)?.z ?? 0;
    expect(element?.z).toBeGreaterThan(boxZ);
    expect(store.selectedElement()?.id).toBe(id);
  });

  it("defaults an Embed's View to the target's default (empty key) when none is given", () => {
    const store = makeStore();
    const id = store.addEmbed({ x: 0, y: 0 }, 'note-1');

    expect((store.document().elements[0] as EmbedElement).viewInstance).toBe('');
    expect(store.document().elements[0].id).toBe(id);
  });

  it('never arms an Embed on placement — it is static until a click arms its read-interaction', () => {
    const store = makeStore();
    store.addEmbed({ x: 0, y: 0 }, 'note-1');
    expect(store.armed()).toBeNull();
  });

  it('arms and disarms an Embed like the single armed element (one at a time)', () => {
    const store = makeStore();
    const a = store.addEmbed({ x: 0, y: 0 }, 'note-1');
    const b = store.addEmbed({ x: 80, y: 0 }, 'note-2');

    store.arm(a);
    expect(store.armed()).toBe(a);
    // Arming the second Embed disarms the first — at most one armed, mirroring the single armed Tool.
    store.arm(b);
    expect(store.armed()).toBe(b);
    store.disarm();
    expect(store.armed()).toBeNull();
  });

  it("re-points an Embed's chosen View through setEmbedView, as one undoable step", () => {
    const store = makeStore();
    const id = store.addEmbed({ x: 0, y: 0 }, 'note-1');

    store.setEmbedView(id, 'core.view.content');
    expect((store.document().elements[0] as EmbedElement).viewInstance).toBe('core.view.content');

    store.undo();
    expect((store.document().elements[0] as EmbedElement).viewInstance).toBe('');
  });

  it('setEmbedView is a no-op (no undo step) for a non-embed element', () => {
    const store = makeStore();
    const box = store.addElement({ x: 0, y: 0 });
    const before = store.document();

    store.setEmbedView(box, 'core.view.content');
    // The document is untouched, and no undo step was recorded beyond the box placement.
    expect(store.document()).toBe(before);
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

  it('records no undo step for a boundary reorder (bringToFront on the top element)', () => {
    const store = makeStore();
    const [a, b, c] = addThreeBoxes(store);
    const undoBefore = store.canUndo();
    store.toFront(c); // already on top: order and dense-z unchanged, so the doc is not dirtied
    expect(store.canUndo()).toBe(undoBefore);
    expect(stackOrder(store)).toEqual([a, b, c]);
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
