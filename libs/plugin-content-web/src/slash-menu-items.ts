import type { Editor, Range } from '@tiptap/core';

/**
 * One insertable block in the Content editor's slash menu. `labelKey` is a Transloco key;
 * `keywords` drive locale-independent filtering; `apply` replaces the typed `/query` range
 * with the block via TipTap commands.
 */
export interface SlashItem {
  id: string;
  labelKey: string;
  keywords: string[];
  apply: (editor: Editor, range: Range) => void;
}

const chainFrom = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    labelKey: 'editor.slashMenu.text',
    keywords: ['text', 'paragraph', 'body'],
    apply: (editor, range) => chainFrom(editor, range).setNode('paragraph').run(),
  },
  {
    id: 'heading1',
    labelKey: 'editor.slashMenu.heading1',
    keywords: ['heading', 'title', 'h1'],
    apply: (editor, range) => chainFrom(editor, range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'heading2',
    labelKey: 'editor.slashMenu.heading2',
    keywords: ['heading', 'title', 'h2', 'subtitle'],
    apply: (editor, range) => chainFrom(editor, range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'heading3',
    labelKey: 'editor.slashMenu.heading3',
    keywords: ['heading', 'title', 'h3'],
    apply: (editor, range) => chainFrom(editor, range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'heading4',
    labelKey: 'editor.slashMenu.heading4',
    keywords: ['heading', 'h4'],
    apply: (editor, range) => chainFrom(editor, range).setNode('heading', { level: 4 }).run(),
  },
  {
    id: 'heading5',
    labelKey: 'editor.slashMenu.heading5',
    keywords: ['heading', 'h5'],
    apply: (editor, range) => chainFrom(editor, range).setNode('heading', { level: 5 }).run(),
  },
  {
    id: 'heading6',
    labelKey: 'editor.slashMenu.heading6',
    keywords: ['heading', 'h6'],
    apply: (editor, range) => chainFrom(editor, range).setNode('heading', { level: 6 }).run(),
  },
  {
    id: 'bulletList',
    labelKey: 'editor.slashMenu.bulletList',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    // ponytail: two-step avoids toggle un-wrapping an existing list
    apply: (editor, range) => {
      chainFrom(editor, range).run();
      if (!editor.isActive('bulletList')) editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    id: 'orderedList',
    labelKey: 'editor.slashMenu.orderedList',
    keywords: ['ordered', 'numbered', 'list', 'ol'],
    apply: (editor, range) => {
      chainFrom(editor, range).run();
      if (!editor.isActive('orderedList')) editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    id: 'blockquote',
    labelKey: 'editor.slashMenu.blockquote',
    keywords: ['quote', 'blockquote', 'citation'],
    apply: (editor, range) => {
      chainFrom(editor, range).run();
      if (!editor.isActive('blockquote')) editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    id: 'codeBlock',
    labelKey: 'editor.slashMenu.codeBlock',
    keywords: ['code', 'codeblock', 'snippet', 'pre'],
    apply: (editor, range) => chainFrom(editor, range).setCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    labelKey: 'editor.slashMenu.horizontalRule',
    keywords: ['divider', 'rule', 'separator', 'hr', 'line'],
    apply: (editor, range) => chainFrom(editor, range).setHorizontalRule().run(),
  },
  {
    // The custom `callout` node (ADR-0033): insert an empty admonition with one
    // paragraph, ready to type into. No dedicated command — `insertContent` from
    // the node's own schema shape is enough (ponytail).
    id: 'callout',
    labelKey: 'editor.slashMenu.callout',
    keywords: ['callout', 'admonition', 'note', 'warning', 'aside', 'box'],
    apply: (editor, range) =>
      chainFrom(editor, range)
        .insertContent({
          type: 'callout',
          attrs: { type: 'note' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    id: 'table',
    labelKey: 'editor.slashMenu.table',
    keywords: ['table', 'grid', 'rows', 'columns'],
    apply: (editor, range) => chainFrom(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'taskList',
    labelKey: 'editor.slashMenu.taskList',
    keywords: ['task', 'todo', 'checklist', 'checkbox'],
    apply: (editor, range) => {
      chainFrom(editor, range).run();
      if (!editor.isActive('taskList')) editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    // Image (ADR-0034): no upload/asset picker yet (assets arrive via vault import),
    // so prompt for a URL — external URLs pass through as the src. ponytail: swap the
    // prompt for a real picker when asset upload lands.
    id: 'image',
    labelKey: 'editor.slashMenu.image',
    keywords: ['image', 'picture', 'photo', 'img', 'asset'],
    apply: (editor, range) => {
      const src = globalThis.prompt?.('Image URL')?.trim();
      const chain = chainFrom(editor, range);
      (src ? chain.setImage({ src }) : chain).run();
    },
  },
  {
    // Routes into the same `@` Entity picker (issue #95, ADR-0023): replace the
    // typed "/link" with "@", letting the mention suggestion drive the one picker.
    id: 'link',
    labelKey: 'editor.slashMenu.entityLink',
    keywords: ['link', 'entity', 'mention', 'reference', 'note', 'map'],
    apply: (editor, range) => chainFrom(editor, range).insertContent('@').run(),
  },
];

/** Filter by `query` against each item's id and keywords, case-insensitively. Empty query → all. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) => item.id.toLowerCase().includes(q) || item.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  );
}
