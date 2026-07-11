import { Node, mergeAttributes } from '@tiptap/core';

/**
 * A `callout` block (ADR-0033): an Obsidian `[!type]` admonition — a coloured box
 * with a `type` ("note", "warning", …) and an optional `title`. Its content is
 * **block** (`group: 'block'`, `content: 'block+'`), not an atom, so links and
 * other nodes inside stay live and editable — the key requirement for keeping
 * inner `entityLink`s clickable.
 *
 * Schema only: the Angular node view (type/title chrome + editable body) attaches
 * at the editor via `.extend({ addNodeView })`, so this stays framework-free and
 * loads in a bare `new Editor({ extensions: CONTENT_EXTENSIONS })` spec.
 */
export const calloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (el) => el.getAttribute('data-callout') || 'note',
        renderHTML: (attrs) => ({ 'data-callout': attrs['type'] }),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-title'),
        renderHTML: (attrs) => (attrs['title'] ? { 'data-title': attrs['title'] } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Copy-paste / no-node-view fallback; the live chrome comes from the node view.
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout-block': '' }), 0];
  },
});
