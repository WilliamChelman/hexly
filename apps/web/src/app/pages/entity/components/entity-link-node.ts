import { Node, mergeAttributes } from '@tiptap/core';

/**
 * A Content Entity Link (CONTEXT.md, ADR-0023): an inline reference to another
 * Entity by id, living in prose. `entityId` is the reference; `label` is a
 * snapshot of the target's name at insert time (the dangling fallback); the
 * optional `descriptor` characterises the relationship ("spouse", "capital of").
 */
export interface EntityLinkAttrs {
  entityId: string;
  label: string;
  descriptor?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityLink: {
      /** Insert an {@link EntityLinkAttrs} atom at the cursor. */
      insertEntityLink: (attrs: EntityLinkAttrs) => ReturnType;
    };
  }
}

/**
 * The `entityLink` inline atom node — part of the `tiptap-v2` format contract
 * (ADR-0019/0023). Schema only: the live-name Angular node view is attached at
 * the editor via `editorProps.nodeViews`, so this stays framework-free and loads
 * in plain `new Editor({ extensions: CONTENT_EXTENSIONS })` specs. `renderHTML`
 * is the copy-paste / no-node-view fallback, showing the stored `label`.
 */
export const entityLinkNode = Node.create({
  name: 'entityLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-entity-id'),
        renderHTML: (attrs) => ({ 'data-entity-id': attrs['entityId'] }),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent,
        renderHTML: (attrs) => ({ 'data-label': attrs['label'] }),
      },
      descriptor: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-descriptor'),
        renderHTML: (attrs) =>
          attrs['descriptor'] ? { 'data-descriptor': attrs['descriptor'] } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-entity-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, { 'data-entity-link': '' }),
      node.attrs['label'] ?? '',
    ];
  },

  addCommands() {
    return {
      insertEntityLink:
        (attrs: EntityLinkAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
