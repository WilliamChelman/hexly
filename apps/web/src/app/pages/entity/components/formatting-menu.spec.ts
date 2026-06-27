import { TestBed } from '@angular/core/testing';
import { Editor } from '@tiptap/core';
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

  const button = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid=format-item-${id}]`) as HTMLButtonElement;

  it('renders a labelled control for each formatting action', () => {
    const { el } = mount();

    const bold = button(el, 'bold');
    expect(bold).not.toBeNull();
    expect(bold.getAttribute('aria-label')).toBe('Bold');
    expect(button(el, 'heading1')).not.toBeNull();
    expect(button(el, 'bulletList')).not.toBeNull();
  });

  it('applies the action to the editor selection when a control is clicked', () => {
    const { fixture, editor, el } = mount();

    button(el, 'bold').click();
    fixture.detectChanges();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.map((m) => m.type)).toContain('bold');
  });

  it('collapses the selection after a control is used so the bubble menu dismisses', () => {
    const { fixture, editor, el } = mount();
    expect(editor.state.selection.empty).toBe(false);

    button(el, 'bold').click();
    fixture.detectChanges();

    // Empty selection → the bubble menu's shouldShow is false → it hides.
    expect(editor.state.selection.empty).toBe(true);
  });

  it('reflects the active formatting at the selection on its controls', () => {
    const { fixture, editor, el } = mount();

    editor.chain().focus().toggleItalic().run();
    fixture.detectChanges();

    expect(button(el, 'italic').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'bold').getAttribute('aria-pressed')).toBe('false');
  });

  it('reveals a URL input, links the selection on submit, then dismisses', () => {
    const { fixture, editor, el } = mount();

    // No input until the link control asks for a URL.
    expect(el.querySelector('[data-testid=format-link-input]')).toBeNull();

    button(el, 'link').click();
    fixture.detectChanges();
    const input = el.querySelector(
      '[data-testid=format-link-input]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    input.value = 'https://example.com';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.find((m) => m.type === 'link')?.attrs?.['href']).toBe(
      'https://example.com',
    );
    expect(el.querySelector('[data-testid=format-link-input]')).toBeNull();
    expect(editor.state.selection.empty).toBe(true);
  });

  it('strips an existing link when its control is clicked', () => {
    const { fixture, editor, el } = mount();

    // Selection already carries a link → the control reads active.
    editor.chain().focus().setLink({ href: 'https://example.com' }).run();
    fixture.detectChanges();
    expect(button(el, 'link').getAttribute('aria-pressed')).toBe('true');

    button(el, 'link').click();
    fixture.detectChanges();

    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.map((m) => m.type)).not.toContain('link');
  });
});
