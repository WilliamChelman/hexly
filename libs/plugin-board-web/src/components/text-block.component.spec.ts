import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Editor } from '@tiptap/core';
import { TextElement } from '@hexly/plugin-board';
import { Content } from '@hexly/plugin-content';
import { ContentEditorComponent } from '@hexly/plugin-content/editor';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardStore } from '../services/board-store';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';
import { TextBlockComponent } from './text-block.component';

/**
 * Proves the Board Text Block reuses the *same editor as an Entity's Content* (#268): armed, it mounts
 * the real {@link ContentEditorComponent} over the adapter session and folds edits back into the store.
 */
describe('TextBlockComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [provideTranslocoTesting({ ...BOARD_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS })],
      providers: [
        ...provideBoardStoreTesting(),
        // The reused Content editor's ambient dependencies (mirrors the ContentEditor spec harness).
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { fragment: of(null) } },
      ],
    }).compileComponents();
  });

  /** Add a Text Block to the store and render a TextBlockComponent bound to it; addText leaves it armed. */
  function setup() {
    const store = TestBed.inject(BoardStore);
    const id = store.addText({ x: 0, y: 0 });
    const element = store.document().elements.find((e) => e.id === id) as TextElement;

    const fixture = TestBed.createComponent(TextBlockComponent);
    (fixture.componentRef as ComponentRef<TextBlockComponent>).setInput('element', element);
    fixture.detectChanges();
    return { store, id, fixture };
  }

  it('renders one Content editor, editable only while armed (#268)', () => {
    const { store, fixture } = setup();

    const editor = fixture.debugElement.query(By.directive(ContentEditorComponent)).componentInstance as {
      editor: () => Editor | null;
    };
    // addText armed the block → the same editor is mounted and editable.
    expect(fixture.nativeElement.querySelector('[data-testid=note-content]')).not.toBeNull();
    expect(editor.editor()!.isEditable).toBe(true);

    store.disarm();
    fixture.detectChanges();
    // Disarmed → the *same* editor stays mounted but turns read-only (no separate display component).
    expect(fixture.nativeElement.querySelector('[data-testid=note-content]')).not.toBeNull();
    expect(editor.editor()!.isEditable).toBe(false);
  });

  it('commits prose typed into the armed editor back into the Text Block through the store', () => {
    const { store, id, fixture } = setup();

    const editor = fixture.debugElement.query(By.directive(ContentEditorComponent)).componentInstance as {
      editor: () => Editor | null;
    };
    editor.editor()!.commands.insertContent('Hail');
    // A save flushes every registered live editor; the adapter forwarded registration to the fake session.
    TestBed.inject(FakeEntitySession).editors.forEach((e) => e.flushPendingCommit());

    const element = store.document().elements.find((e) => e.id === id);
    const snapshot = element?.kind === 'text' ? (element.content as Content).snapshot : null;
    expect(JSON.stringify(snapshot)).toContain('Hail');
  });
});
