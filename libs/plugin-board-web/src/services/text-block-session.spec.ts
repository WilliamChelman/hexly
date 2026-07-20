import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { emptyContent, tiptapContent, type Content } from '@hexly/plugin-content';
import { EntityDocument } from '@hexly/domain';
import { BoardStore } from './board-store';
import { TextBlockSession, TEXT_CONTENT_KEY } from './text-block-session';
import { provideBoardStoreTesting } from '../testing/entity-session.fake';

/**
 * The adapter injects the real board session with `skipSelf`, so it needs a parent injector that carries
 * it. A child injector holding only the adapter, parented on the TestBed's, reproduces the component
 * wiring (the adapter is provided *below* the route's `ENTITY_SESSION`).
 */
function makeSession(): { store: BoardStore; session: TextBlockSession } {
  const store = TestBed.inject(BoardStore);
  const child = Injector.create({ providers: [TextBlockSession], parent: TestBed.inject(Injector) });
  return { store, session: child.get(TextBlockSession) };
}

const prose = (text: string): Content =>
  tiptapContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('TextBlockSession', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideBoardStoreTesting() });
  });

  it('presents the bound Text Block’s prose as a one-Field body under the content key', () => {
    const { store, session } = makeSession();
    const id = store.addText({ x: 0, y: 0 });
    store.setContent(id, prose('Whisperwood'));
    session.setTarget(id);

    expect(session.doc()).toEqual({ [TEXT_CONTENT_KEY]: prose('Whisperwood') });
  });

  it('opens on an empty document when nothing is bound', () => {
    const { session } = makeSession();

    expect(session.doc()).toEqual({ [TEXT_CONTENT_KEY]: emptyContent() });
  });

  it('folds the editor’s commit back into the bound Text Block as one undoable board step', () => {
    const { store, session } = makeSession();
    const id = store.addText({ x: 0, y: 0 });
    session.setTarget(id);

    // The reused Content editor commits by assigning a fresh value at the content key.
    session.mutate((body: EntityDocument) => {
      body[TEXT_CONTENT_KEY] = prose('The Keep');
    });

    const element = store.document().elements.find((e) => e.id === id);
    expect(element?.kind === 'text' && element.content).toEqual(prose('The Keep'));

    store.undo();
    const afterUndo = store.document().elements.find((e) => e.id === id);
    expect(afterUndo?.kind === 'text' && afterUndo.content).toEqual(emptyContent());
  });

  it('ticks its exposed loadGeneration on a board undo, so the live editor re-seeds', () => {
    const { store, session } = makeSession();
    const id = store.addText({ x: 0, y: 0 });
    session.setTarget(id);
    const before = session.loadGeneration();

    store.setContent(id, prose('The Keep'));
    // A commit is no replay: re-seeding here would rebuild the editor mid-typing and drop the caret.
    expect(session.loadGeneration()).toBe(before);

    store.undo();
    // The document reverted under the still-mounted editor; without this tick its next debounced commit
    // would push the pre-undo prose back — silently un-undoing (the reported bug).
    expect(session.loadGeneration()).not.toBe(before);
  });
});
