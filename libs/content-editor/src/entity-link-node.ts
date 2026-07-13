import { Node, mergeAttributes } from '@tiptap/core';
import { EntityLinkAttrs, entityLinkText } from '@hexly/domain';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityLink: {
      /** Insert an {@link EntityLinkAttrs} atom at the cursor. */
      insertEntityLink: (attrs: EntityLinkAttrs) => ReturnType;
    };
  }
}

/**
 * The `entityLink` inline atom node — part of the format contract (ADR-0023/0033).
 * Schema only: the live-name Angular node view is attached at the editor via
 * `editorProps.nodeViews`, so this stays framework-free. `renderHTML` is the
 * copy-paste / no-node-view fallback, showing the static `display` text when set,
 * else the stored `label`.
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
        renderHTML: (attrs) => (attrs['descriptor'] ? { 'data-descriptor': attrs['descriptor'] } : {}),
      },
      // Optional wikilink semantics (ADR-0033), each omitted from HTML when unset.
      display: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-display'),
        renderHTML: (attrs) => (attrs['display'] ? { 'data-display': attrs['display'] } : {}),
      },
      heading: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-heading'),
        renderHTML: (attrs) => (attrs['heading'] ? { 'data-heading': attrs['heading'] } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-entity-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-entity-link': '',
        href: `/entities/${node.attrs['entityId'] ?? ''}`,
      }),
      entityLinkText(node.attrs),
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
