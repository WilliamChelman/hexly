import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CONTENT_FORMAT, Content, EntityDetail, tiptapContent } from '@hexly/domain';
import { Editor } from '@tiptap/core';
import { EntityNameResolver } from './entity-name-resolver';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { ContentEditor } from './content-editor';
import { CONTENT_EDITOR_SESSION, ContentEditorSession } from './content-editor-session';

// A minimal note EntityDetail — the lib owns its own fixture rather than the entity
// page's (owner Rights keep the editor writable, ADR-0039).
const noteDetail = (name: string): EntityDetail => ({
  id: 'n1',
  worldId: 'w1',
  name,
  types: ['core.note'],
  tags: [],
  visibility: 'private',
  version: 1,
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
  document: { content: { format: CONTENT_FORMAT, snapshot: {} } },
});

// Drives ContentEditor via the token, standing in for the page's EntitySession:
// adopt seeds, setContent streams edits back — the 4 members the editor reads.
class FakeEditorSession implements ContentEditorSession {
  private readonly _content = signal<Content | null>(null);
  private readonly _seed = signal<EntityDetail | null>(null);
  readonly content = this._content.asReadonly();
  readonly seed = this._seed.asReadonly();
  readonly writable = signal(true);

  setContent(snapshot: unknown): void {
    this._content.set(tiptapContent(snapshot));
  }
  adopt(detail: EntityDetail): void {
    this._content.set(detail.document.content);
    this._seed.set(detail);
  }
}

describe('ContentEditor', () => {
  const note = noteDetail;

  // The route fragment a `[[Target#Heading]]` link navigates to; ContentEditor
  // watches it to scroll the open note to the matching heading (ADR-0033).
  const fragment$ = new BehaviorSubject<string | null>(null);

  const noteWithProse = (text: string): EntityDetail => ({
    ...note('Lady Mara'),
    document: {
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
  // Non-null: called after detectChanges(), so the seed has fired.
  const editorOf = (fixture: { componentInstance: unknown }) =>
    (fixture.componentInstance as { editor: () => Editor | null }).editor()!;

  // The bubble menu registers a ProseMirror plugin keyed by name; its presence
  // proves BubbleMenuDirective bound to this editor instance.
  const hasBubbleMenu = (editor: Editor) =>
    editor.state.plugins.some((p) => {
      const key = (p.spec.key as { key?: string } | undefined)?.key;
      return typeof key === 'string' && key.startsWith('formattingBubbleMenu');
    });

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
    fragment$.next(null);
    await TestBed.configureTestingModule({
      imports: [ContentEditor, provideTranslocoTesting()],
      providers: [
        { provide: CONTENT_EDITOR_SESSION, useClass: FakeEditorSession },
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { fragment: fragment$ } },
      ],
    }).compileComponents();
  });

  it('seeds the editor with the open Entity’s stored Content', () => {
    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt(
      noteWithProse('Lady Mara rules the north.'),
    );

    const fixture = create();

    const surface = fixture.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Lady Mara rules the north.');
  });

  it('renders a callout’s node view — its type/title chrome around live body content', () => {
    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt({
      ...note('Lady Mara'),
      document: {
        content: {
          format: CONTENT_FORMAT,
          snapshot: {
            type: 'doc',
            content: [
              {
                type: 'callout',
                attrs: { type: 'warning', title: 'Beware' },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'The pass is watched.' }] },
                ],
              },
            ],
          },
        },
      },
    });

    const fixture = create();

    const callout = fixture.nativeElement.querySelector('.callout') as HTMLElement;
    expect(callout).not.toBeNull();
    expect(callout.textContent).toContain('Beware');
    expect(callout.textContent).toContain('The pass is watched.');
  });

  it('scrolls to the first heading matching the route fragment (ADR-0033)', () => {
    // jsdom has no layout; stub scrollIntoView so we can assert which node got it.
    HTMLElement.prototype.scrollIntoView ??= () => undefined;
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt({
      ...note('Lady Mara'),
      document: {
        content: {
          format: CONTENT_FORMAT,
          snapshot: {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Origins' }] },
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'History' }] },
            ],
          },
        },
      },
    });

    const fixture = create();
    fragment$.next('History');
    fixture.detectChanges();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    const scrolled = scrollSpy.mock.instances[0] as HTMLElement;
    expect(scrolled.textContent).toBe('History');

    scrollSpy.mockRestore();
  });

  it('does not scroll when the fragment matches no heading (best-effort anchor)', () => {
    HTMLElement.prototype.scrollIntoView ??= () => undefined;
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt(noteWithProse('Just a paragraph.'));
    const fixture = create();
    fragment$.next('Nowhere');
    fixture.detectChanges();

    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('labels the editable surface with the supplied aria-label', () => {
    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt(note('Lady Mara'));

    const fixture = create();

    expect(editorOf(fixture).view.dom.getAttribute('aria-label')).toBe(
      'Content',
    );
  });

  it('opens the slash menu of insertable blocks when “/” is typed', async () => {
    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt(note('Lady Mara'));

    const fixture = create();

    editorOf(fixture).commands.insertContent('/');
    // @tiptap/suggestion resolves items() async, then fires onStart/onUpdate.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('[data-testid=slash-menu]');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Heading 1');
  });

  it('mounts the formatting bubble menu', () => {
    (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession).adopt(note('Lady Mara'));

    const fixture = create();

    expect(fixture.nativeElement.querySelector('[role=toolbar]')).not.toBeNull();
  });

  it('rebuilds the editor on re-seed and destroys the previous instance', async () => {
    const session = (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession);
    session.adopt(noteWithProse('Original prose.'));

    const fixture = create();
    const first = editorOf(fixture);

    // A conflict reload / Entity swap re-seeds with the server's stored Content.
    session.adopt(noteWithProse('Reseeded prose.'));
    fixture.detectChanges();
    const second = editorOf(fixture);

    // Previous editor is destroyed via queueMicrotask (after the new surface
    // mounts); flush the queue before asserting.
    await new Promise((r) => queueMicrotask(r as () => void));

    expect(second).not.toBe(first);
    expect(first.isDestroyed).toBe(true);
    expect(hasBubbleMenu(second)).toBe(true);

    const surface = fixture.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Reseeded prose.');
    expect(surface.textContent).not.toContain('Original prose.');
  });

  it('seeds a remounted editor from the live Content, not the stale load snapshot', () => {
    // Repro of the Map↔Note toggle bug (#75): the editor is destroyed/recreated
    // across views. A clean save advances the session's live Content but not its
    // seed, so a remount must re-seed from the live edits, not the load snapshot.
    const session = (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession);
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
    const session = (TestBed.inject(CONTENT_EDITOR_SESSION) as FakeEditorSession);
    session.adopt(noteWithProse('Original prose.'));

    const fixture = create();

    session.adopt(noteWithProse('Reseeded prose.')); // re-seed → fresh editor
    fixture.detectChanges();

    const spy = vi.spyOn(session, 'setContent');
    editorOf(fixture).commands.insertContent('!');
    expect(spy).toHaveBeenCalled();
  });
});
