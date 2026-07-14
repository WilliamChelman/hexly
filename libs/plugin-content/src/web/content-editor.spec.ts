import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { Content, CONTENT_FORMAT, tiptapContent } from '../lib';
import { Editor } from '@tiptap/core';
import { FakeEntitySession, provideFakeEntitySession } from '@hexly/web-entity/testing';
import { EntityNameResolver } from './entity-name-resolver';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '../i18n/test-catalogs';
import { ContentEditor } from './content-editor';

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

// Drives ContentEditor via ENTITY_SESSION — the same central store the app binds (ADR-0051): a load
// bumps loadGeneration to (re)seed the editor, which commits its doc back through mutate.
const adopt = (session: FakeEntitySession, detail: EntityDetail) => session.loadDoc(detail.document);

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
    (fixture.componentRef as ComponentRef<ContentEditor>).setInput('ariaLabel', 'Content');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    fragment$.next(null);
    await TestBed.configureTestingModule({
      imports: [ContentEditor, provideTranslocoTesting(CONTENT_EDITOR_TEST_CATALOGS)],
      providers: [
        provideFakeEntitySession(),
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { fragment: fragment$ } },
      ],
    }).compileComponents();
  });

  it('seeds the editor with the open Entity’s stored Content', () => {
    adopt(TestBed.inject(FakeEntitySession), noteWithProse('Lady Mara rules the north.'));

    const fixture = create();

    const surface = fixture.nativeElement.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('Lady Mara rules the north.');
  });

  it('renders a callout’s node view — its type/title chrome around live body content', () => {
    adopt(TestBed.inject(FakeEntitySession), {
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
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'The pass is watched.' }],
                  },
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
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);

    adopt(TestBed.inject(FakeEntitySession), {
      ...note('Lady Mara'),
      document: {
        content: {
          format: CONTENT_FORMAT,
          snapshot: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Origins' }],
              },
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'History' }],
              },
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
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);

    adopt(TestBed.inject(FakeEntitySession), noteWithProse('Just a paragraph.'));
    const fixture = create();
    fragment$.next('Nowhere');
    fixture.detectChanges();

    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('labels the editable surface with the supplied aria-label', () => {
    adopt(TestBed.inject(FakeEntitySession), note('Lady Mara'));

    const fixture = create();

    expect(editorOf(fixture).view.dom.getAttribute('aria-label')).toBe('Content');
  });

  it('opens the slash menu of insertable blocks when “/” is typed', async () => {
    adopt(TestBed.inject(FakeEntitySession), note('Lady Mara'));

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
    adopt(TestBed.inject(FakeEntitySession), note('Lady Mara'));

    const fixture = create();

    expect(fixture.nativeElement.querySelector('[role=toolbar]')).not.toBeNull();
  });

  it('rebuilds the editor on re-seed and destroys the previous instance', async () => {
    const session = TestBed.inject(FakeEntitySession);
    adopt(session, noteWithProse('Original prose.'));

    const fixture = create();
    const first = editorOf(fixture);

    // A conflict reload / Entity swap re-seeds with the server's stored Content.
    adopt(session, noteWithProse('Reseeded prose.'));
    fixture.detectChanges();
    const second = editorOf(fixture);

    // Previous editor is destroyed via queueMicrotask (after the new surface
    // mounts); flush the queue before asserting.
    await new Promise((r) => queueMicrotask(r as () => void));

    expect(second).not.toBe(first);
    expect(first.isDestroyed).toBe(true);
    expect(hasBubbleMenu(second)).toBe(true);

    const surface = fixture.nativeElement.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('Reseeded prose.');
    expect(surface.textContent).not.toContain('Original prose.');
  });

  it('seeds a remounted editor from the working body, not the stale load snapshot', () => {
    // Repro of the Map↔Note toggle bug (#75): the editor is destroyed/recreated
    // across views without a fresh load. Committing prose into the body advances it but bumps no
    // loadGeneration, so a remount within the same load must re-seed from the body — the latest
    // committed prose — not the loaded snapshot.
    const session = TestBed.inject(FakeEntitySession);
    adopt(session, noteWithProse('Original prose.'));

    const first = create();
    expect((first.nativeElement.querySelector('[data-testid=note-content]') as HTMLElement).textContent).toContain(
      'Original prose.',
    );

    // The user edits: the editor commits the new prose into the body (no loadGeneration tick).
    session.mutate((body) => {
      body['content'] = tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited prose.' }] }],
      });
    });

    // Leaving the Note view destroys the editor; returning mounts a fresh one.
    first.destroy();
    const second = create();

    const surface = second.nativeElement.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('Edited prose.');
    expect(surface.textContent).not.toContain('Original prose.');
  });

  it('does not commit a load-time normalization of an unchanged document (#164)', () => {
    const session = TestBed.inject(FakeEntitySession);
    adopt(session, noteWithProse('Lady Mara rules the north.'));
    const fixture = create();

    const spy = vi.spyOn(session, 'mutate');
    // TipTap re-emits `update` on load-time normalization; a doc value-equal to the seeded one is
    // not an edit, so it must never mint a phantom commit (the invariant #164 protects).
    const editor = editorOf(fixture);
    editor.commands.setContent(editor.getJSON()); // emits `update` with the same doc
    session.editors.forEach((e) => e.flushPendingCommit());

    expect(spy).not.toHaveBeenCalled();
  });

  it('commits edits into the body through mutate, flushed as a save would', () => {
    const session = TestBed.inject(FakeEntitySession);
    adopt(session, noteWithProse('Original prose.'));

    const fixture = create();

    adopt(session, noteWithProse('Reseeded prose.')); // re-seed → fresh editor
    fixture.detectChanges();

    const spy = vi.spyOn(session, 'mutate');
    editorOf(fixture).commands.insertContent('!');
    // The commit is debounced; a save flushes every registered live editor first (ADR-0051).
    session.editors.forEach((editor) => editor.flushPendingCommit());

    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify((session.doc()['content'] as Content).snapshot)).toContain('!');
  });
});
