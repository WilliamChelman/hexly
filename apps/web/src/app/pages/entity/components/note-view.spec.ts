import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CONTENT_FORMAT, EntityDetail } from '@hexly/domain';
import { Editor } from '@tiptap/core';
import { EntitySession } from '../services/entity-session';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { NoteView } from './note-view';

describe('NoteView', () => {
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoteView, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('shows the open note’s name', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lady Mara');
  });

  it('offers a way back to the library', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    const back = fixture.nativeElement.querySelector(
      '[data-testid=back-to-library]',
    ) as HTMLAnchorElement;
    expect(back).not.toBeNull();
    expect(back.getAttribute('href')).toBe('/entities');
  });

  it('seeds the editor with the open note’s stored Content', () => {
    const detail = note('Lady Mara');
    TestBed.inject(EntitySession).adopt({
      ...detail,
      document: {
        type: 'note',
        content: {
          format: 'tiptap-v1',
          snapshot: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Lady Mara rules the north.' }],
              },
            ],
          },
        },
      },
    });

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    // The stored prose renders into the editable surface — proving the snapshot
    // was loaded into the editor, not just held opaquely in the session.
    const surface = fixture.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Lady Mara rules the north.');
  });

  it('opens the slash menu of insertable blocks when “/” is typed', async () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    // Type "/" into the live editor; the suggestion plugin should surface the menu.
    editorOf(fixture).commands.insertContent('/');
    // @tiptap/suggestion resolves items() asynchronously, then fires onStart/onUpdate.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('[data-testid=slash-menu]');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Heading 1');
  });

  it('mounts the formatting bubble menu for the open note', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    // The toolbar is rendered (hidden until a selection); the bubble-menu plugin
    // owns its show/hide, so presence is what wiring guarantees here.
    expect(
      fixture.nativeElement.querySelector('[role=toolbar]'),
    ).not.toBeNull();
  });

  it('rebuilds the editor on re-seed and destroys the previous instance', () => {
    const session = TestBed.inject(EntitySession);
    session.adopt(noteWithProse('Original prose.'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();
    const first = editorOf(fixture);

    // A conflict reload / note swap re-seeds with the server's stored Content.
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

  it('streams edits to the session after a re-seed', () => {
    const session = TestBed.inject(EntitySession);
    session.adopt(noteWithProse('Original prose.'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    session.adopt(noteWithProse('Reseeded prose.')); // re-seed → fresh editor
    fixture.detectChanges();

    const spy = vi.spyOn(session, 'setContent');
    editorOf(fixture).commands.insertContent('!');
    // The new editor's update listener must be wired, or edits silently stop saving.
    expect(spy).toHaveBeenCalled();
  });

  it('mounts the tag editor for the open note', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-tags]'),
    ).not.toBeNull();
  });
});
