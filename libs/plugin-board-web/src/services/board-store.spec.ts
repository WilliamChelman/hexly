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
