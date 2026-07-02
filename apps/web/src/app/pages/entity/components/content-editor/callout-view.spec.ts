import { ApplicationRef, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Editor } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { calloutNode } from './callout-node';
import { CalloutView, createCalloutNodeView } from './callout-view';

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
    expect(dom.textContent).toContain('warning');
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

  it('lets the reader change the callout type — updating the node attr', () => {
    const { editor, view } = nodeViewFor({ type: 'note', title: null });
    const select = (view.dom as HTMLElement).querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('note');

    // Pick a different type as a user would; the change flows back into the doc.
    select.value = 'warning';
    select.dispatchEvent(new Event('change'));

    expect(editor.state.doc.firstChild?.attrs['type']).toBe('warning');

    view.destroy?.();
    editor.destroy();
  });

  it('keeps an unknown (imported) type selectable rather than dropping it', () => {
    const { editor, view } = nodeViewFor({ type: 'custom-obsidian', title: null });
    const select = (view.dom as HTMLElement).querySelector('select') as HTMLSelectElement;

    expect(select.value).toBe('custom-obsidian');
    expect(
      Array.from(select.options).some((o) => o.value === 'custom-obsidian'),
    ).toBe(true);

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
