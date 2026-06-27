import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CONTENT_FORMAT, EntityDetail } from '@hexly/domain';
import { Editor } from '@tiptap/core';
import { EntitySession } from '../services/entity-session';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { ContentEditor } from './content-editor';

describe('ContentEditor', () => {
  const note = (name: string): EntityDetail => ({
    id: 'n1',
    ownerId: 'u1',
    name,
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: { type: 'note', content: { format: CONTENT_FORMAT, snapshot: {} } },
  });

  // A note whose stored snapshot carries a paragraph of prose, to prove re-seeding.
  const noteWithProse = (text: string): EntityDetail => ({
    ...note('Lady Mara'),
    document: {
      type: 'note',
      content: {
        format: CONTENT_FORMAT,
        snapshot: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      },
    },
  });

  // The editor is a recreated-on-seed signal; reach through to the live instance.
  const editorOf = (fixture: { componentInstance: unknown }) =>
    (fixture.componentInstance as { editor: () => Editor }).editor();

  // The formatting bubble menu registers a ProseMirror plugin keyed by name; its
  // presence on an editor proves BubbleMenuDirective bound to that instance.
  const hasBubbleMenu = (editor: Editor) =>
    editor.state.plugins.some((p) => {
      const key = (p.spec.key as { key?: string } | undefined)?.key;
      return typeof key === 'string' && key.startsWith('formattingBubbleMenu');
    });

  /** Create the editor with a (required) aria-label set, like every caller. */
  function create() {
    const fixture = TestBed.createComponent(ContentEditor);
    (fixture.componentRef as ComponentRef<ContentEditor>).setInput(
      'ariaLabel',
      'Content',
    );
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentEditor, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('seeds the editor with the open Entity’s stored Content', () => {
    TestBed.inject(EntitySession).adopt(
      noteWithProse('Lady Mara rules the north.'),
    );

    const fixture = create();

    // The stored prose renders into the editable surface — proving the snapshot
    // was loaded into the editor, not just held opaquely in the session.
    const surface = fixture.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Lady Mara rules the north.');
  });

  it('labels the editable surface with the supplied aria-label', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = create();

    expect(editorOf(fixture).view.dom.getAttribute('aria-label')).toBe(
      'Content',
    );
  });

  it('opens the slash menu of insertable blocks when “/” is typed', async () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = create();

    // Type "/" into the live editor; the suggestion plugin should surface the menu.
    editorOf(fixture).commands.insertContent('/');
    // @tiptap/suggestion resolves items() asynchronously, then fires onStart/onUpdate.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('[data-testid=slash-menu]');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Heading 1');
  });

  it('mounts the formatting bubble menu', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = create();

    // The toolbar is rendered (hidden until a selection); the bubble-menu plugin
    // owns its show/hide, so presence is what wiring guarantees here.
    expect(fixture.nativeElement.querySelector('[role=toolbar]')).not.toBeNull();
  });

  it('rebuilds the editor on re-seed and destroys the previous instance', () => {
    const session = TestBed.inject(EntitySession);
    session.adopt(noteWithProse('Original prose.'));

    const fixture = create();
    const first = editorOf(fixture);

    // A conflict reload / Entity swap re-seeds with the server's stored Content.
    session.adopt(noteWithProse('Reseeded prose.'));
    fixture.detectChanges();
    const second = editorOf(fixture);

    expect(second).not.toBe(first);
    expect(first.isDestroyed).toBe(true);
    // The bubble menu must follow onto the fresh editor (the reason epoch once existed).
    expect(hasBubbleMenu(second)).toBe(true);

    const surface = fixture.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Reseeded prose.');
    expect(surface.textContent).not.toContain('Original prose.');
  });

  it('seeds a remounted editor from the live Content, not the stale load snapshot', () => {
    // Repro of the hexmap Map↔Note toggle bug (#75): the editor is destroyed when
    // the user leaves the Note view and recreated on return. A clean save updates
    // the session's live Content but not its seed, so a remount must read the live
    // edits — otherwise it re-seeds the originally-loaded prose and the edit vanishes
    // until a full reload.
    const session = TestBed.inject(EntitySession);
    session.adopt(noteWithProse('Original prose.'));

    const first = create();
    expect(
      (first.nativeElement.querySelector('[data-testid=note-content]') as HTMLElement)
        .textContent,
    ).toContain('Original prose.');

    // The user edits and saves: the live Content advances, the seed does not.
    session.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Edited prose.' }] },
      ],
    });

    // Leaving the Note view destroys the editor; returning mounts a fresh one.
    first.destroy();
    const second = create();

    const surface = second.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Edited prose.');
    expect(surface.textContent).not.toContain('Original prose.');
  });

  it('streams edits to the session after a re-seed', () => {
    const session = TestBed.inject(EntitySession);
    session.adopt(noteWithProse('Original prose.'));

    const fixture = create();

    session.adopt(noteWithProse('Reseeded prose.')); // re-seed → fresh editor
    fixture.detectChanges();

    const spy = vi.spyOn(session, 'setContent');
    editorOf(fixture).commands.insertContent('!');
    // The new editor's update listener must be wired, or edits silently stop saving.
    expect(spy).toHaveBeenCalled();
  });
});
