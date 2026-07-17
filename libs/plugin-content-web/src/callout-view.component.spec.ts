import { ApplicationRef, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Editor } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { calloutNode } from './callout-node';
import { CalloutView, createCalloutNodeView } from './callout-view.component';

describe('CalloutView node view', () => {
  function nodeViewFor(attrs: Record<string, unknown>) {
    // A real callout node from the schema, so attrs are normalized as at runtime.
    const editor = new Editor({
      extensions: CONTENT_EXTENSIONS,
      content: {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
          },
        ],
      },
    });
    const node = editor.state.doc.firstChild!;
    // The callout is the first (and only) top-level node, so its position is 0.
    const view = createCalloutNodeView(
      node,
      editor,
      () => 0,
      TestBed.inject(EnvironmentInjector),
      TestBed.inject(ApplicationRef),
    );
    return { editor, node, view };
  }

  it('renders the callout type and title chrome', () => {
    const { editor, view } = nodeViewFor({ type: 'warning', title: 'Beware' });
    const dom = view.dom as HTMLElement;

    expect(dom.querySelector('.callout')?.getAttribute('data-callout')).toBe('warning');
    expect((dom.querySelector('input') as HTMLInputElement).value).toBe('warning');
    expect(dom.textContent).toContain('Beware');

    view.destroy?.();
    editor.destroy();
  });

  it('exposes an editable body as contentDOM so inner content (links) stays live', () => {
    const { editor, view } = nodeViewFor({ type: 'note', title: null });
    const dom = view.dom as HTMLElement;

    // contentDOM must live inside the component DOM — that is where ProseMirror
    // renders the block children, keeping inner entityLinks clickable (ADR-0033).
    expect(view.contentDOM).toBeTruthy();
    expect(dom.contains(view.contentDOM!)).toBe(true);

    view.destroy?.();
    editor.destroy();
  });

  it('lets the reader edit the callout type as free text — updating the node attr', () => {
    const { editor, view } = nodeViewFor({ type: 'note', title: null });
    const input = (view.dom as HTMLElement).querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('note');

    // Type any value; on change (blur/enter) it flows back into the doc.
    input.value = 'warning';
    input.dispatchEvent(new Event('change'));

    expect(editor.state.doc.firstChild?.attrs['type']).toBe('warning');

    view.destroy?.();
    editor.destroy();
  });

  it('stops ProseMirror from handling events in the header, so the type input edits natively', () => {
    // Without this, a Backspace in the type input bubbles to ProseMirror's keymap
    // and deletes the whole callout node — the reported bug.
    const { editor, view } = nodeViewFor({ type: 'note', title: null });
    const input = (view.dom as HTMLElement).querySelector('input') as HTMLInputElement;

    // Events from the header chrome are the browser's to handle...
    expect(view.stopEvent?.({ target: input } as unknown as Event)).toBe(true);
    // ...while events in the editable body stay with ProseMirror.
    expect(view.stopEvent?.({ target: view.contentDOM } as unknown as Event)).toBe(false);

    view.destroy?.();
    editor.destroy();
  });

  // A doc where the callout follows a paragraph, so both exit directions land somewhere.
  function calloutAfterParagraph() {
    const editor = new Editor({
      extensions: CONTENT_EXTENSIONS,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'above' }] },
          {
            type: 'callout',
            attrs: { type: 'note', title: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
          },
        ],
      },
    });
    const calloutPos = editor.state.doc.child(0).nodeSize; // position just before the callout
    const view = createCalloutNodeView(
      editor.state.doc.child(1),
      editor,
      () => calloutPos,
      TestBed.inject(EnvironmentInjector),
      TestBed.inject(ApplicationRef),
    );
    const input = (view.dom as HTMLElement).querySelector('input') as HTMLInputElement;
    return { editor, view, input };
  }

  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('drops the caret into the callout body on ArrowDown / Enter / Escape', () => {
    for (const key of ['ArrowDown', 'Enter', 'Escape']) {
      const { editor, view, input } = calloutAfterParagraph();
      press(input, key);
      expect(editor.state.selection.$head.parent.textContent).toBe('body');
      view.destroy?.();
      editor.destroy();
    }
  });

  it('moves the caret above the callout on ArrowUp (no trap — you can leave upward)', () => {
    const { editor, view, input } = calloutAfterParagraph();
    press(input, 'ArrowUp');
    expect(editor.state.selection.$head.parent.textContent).toBe('above');
    view.destroy?.();
    editor.destroy();
  });

  it('keeps the type input out of the Tab order so Tab never jumps to it', () => {
    const { editor, view } = nodeViewFor({ type: 'note', title: null });
    const input = (view.dom as HTMLElement).querySelector('input') as HTMLInputElement;
    expect(input.tabIndex).toBe(-1);
    view.destroy?.();
    editor.destroy();
  });

  it('shows an arbitrary (imported) type verbatim in the input', () => {
    const { editor, view } = nodeViewFor({
      type: 'custom-obsidian',
      title: null,
    });
    const input = (view.dom as HTMLElement).querySelector('input') as HTMLInputElement;

    expect(input.value).toBe('custom-obsidian');

    view.destroy?.();
    editor.destroy();
  });

  it('re-applies attrs on update but rejects a different node type', () => {
    const { editor, node, view } = nodeViewFor({ type: 'note', title: 'Old' });

    const renamed = node.type.create({ type: 'info', title: 'New' }, node.content);
    expect(view.update?.(renamed, [], null as never)).toBe(true);
    expect((view.dom as HTMLElement).textContent).toContain('New');

    // A node of another type is not ours to update.
    const foreign = editor.state.schema.nodes['paragraph'].create();
    expect(view.update?.(foreign, [], null as never)).toBe(false);

    view.destroy?.();
    editor.destroy();
  });

  it('is the same component the schema stays free of (framework-free node)', () => {
    // calloutNode carries no node view; the Angular view is attached at the editor.
    expect((calloutNode as { config?: { addNodeView?: unknown } }).config?.addNodeView).toBeFalsy();
    expect(CalloutView).toBeDefined();
  });
});
