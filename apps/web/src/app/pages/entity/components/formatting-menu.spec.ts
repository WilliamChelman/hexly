import { TestBed } from '@angular/core/testing';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { FormattingMenu } from './formatting-menu';

describe('FormattingMenu', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormattingMenu, provideTranslocoTesting()],
    }).compileComponents();
  });

  function mount(text = 'Lady Mara') {
    const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    editor.commands.setTextSelection({ from: 1, to: text.length + 1 });

    const fixture = TestBed.createComponent(FormattingMenu);
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();
    return { fixture, editor, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, label: string) =>
    el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

  it('renders a labelled control for each formatting action', () => {
    const { el } = mount();

    expect(button(el, 'Bold')).not.toBeNull();
    expect(button(el, 'Heading 1')).not.toBeNull();
    expect(button(el, 'Bullet list')).not.toBeNull();
  });

  it('applies the action to the editor selection when a control is clicked', () => {
    const { fixture, editor, el } = mount();

    button(el, 'Bold').click();
    fixture.detectChanges();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.map((m) => m.type)).toContain('bold');
  });

  it('collapses the selection after a control is used so the bubble menu dismisses', () => {
    const { fixture, editor, el } = mount();
    expect(editor.state.selection.empty).toBe(false);

    button(el, 'Bold').click();
    fixture.detectChanges();

    // Empty selection → the bubble menu's shouldShow is false → it hides.
    expect(editor.state.selection.empty).toBe(true);
  });

  it('reflects the active formatting at the selection on its controls', () => {
    const { fixture, editor, el } = mount();

    editor.chain().focus().toggleItalic().run();
    fixture.detectChanges();

    expect(button(el, 'Italic').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'Bold').getAttribute('aria-pressed')).toBe('false');
  });

  it('reveals a URL input, links the selection on submit, then dismisses', () => {
    const { fixture, editor, el } = mount();

    // No input until the link control asks for a URL.
    expect(el.querySelector('input[type=url]')).toBeNull();

    button(el, 'Link').click();
    fixture.detectChanges();
    const input = el.querySelector('input[type=url]') as HTMLInputElement;
    expect(input).not.toBeNull();

    input.value = 'https://example.com';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.find((m) => m.type === 'link')?.attrs?.['href']).toBe(
      'https://example.com',
    );
    expect(el.querySelector('input[type=url]')).toBeNull();
    expect(editor.state.selection.empty).toBe(true);
  });

  it('strips an existing link when its control is clicked', () => {
    const { fixture, editor, el } = mount();

    // Selection already carries a link → the control reads active.
    editor.chain().focus().setLink({ href: 'https://example.com' }).run();
    fixture.detectChanges();
    expect(button(el, 'Link').getAttribute('aria-pressed')).toBe('true');

    button(el, 'Link').click();
    fixture.detectChanges();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.map((m) => m.type)).not.toContain('link');
  });

  it('moves focus to the URL input after the link button is clicked', () => {
    const { fixture, el } = mount();

    button(el, 'Link').click();
    fixture.detectChanges();

    const input = el.querySelector('input[type=url]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  it('collapses to the head position on dismiss, respecting right-to-left selection direction', () => {
    const { fixture, editor, el } = mount();

    // Create a backwards selection: anchor=10 (end), head=1 (start).
    // selection.to === 10, selection.head === 1.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10, 1)),
    );
    fixture.detectChanges();

    button(el, 'Bold').click();
    fixture.detectChanges();

    // Should collapse to head (1), not to (10).
    expect(editor.state.selection.head).toBe(1);
  });

  it('resets the URL input when the editor instance is swapped', () => {
    const { fixture, el } = mount();

    button(el, 'Link').click();
    fixture.detectChanges();
    expect(el.querySelector('input[type=url]')).not.toBeNull();

    const newEditor = new Editor({ extensions: CONTENT_EXTENSIONS });
    fixture.componentRef.setInput('editor', newEditor);
    fixture.detectChanges();

    expect(el.querySelector('input[type=url]')).toBeNull();
    newEditor.destroy();
  });
});
