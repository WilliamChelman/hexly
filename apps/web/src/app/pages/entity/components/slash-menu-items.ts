import type { Editor, Range } from '@tiptap/core';

/**
 * One insertable block in the Content editor's slash menu (#73). `labelKey` is a
 * Transloco key (copy is client-owned, ADR-0014); `keywords` drive locale-independent
 * filtering; `apply` replaces the typed `/query` range with the block via TipTap commands.
 *
 * Every block here is already in {@link CONTENT_EXTENSIONS} (StarterKit), so inserting one
 * needs no format bump and round-trips through the opaque snapshot for free (ADR-0019).
 */
export interface SlashItem {
  id: string;
  labelKey: string;
  keywords: string[];
  apply: (editor: Editor, range: Range) => void;
}

const chainFrom = (editor: Editor, range: Range) =>
  editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    labelKey: 'noteView.slashMenu.text',
    keywords: ['text', 'paragraph', 'body'],
    apply: (editor, range) => chainFrom(editor, range).setNode('paragraph').run(),
  },
  {
    id: 'heading1',
    labelKey: 'noteView.slashMenu.heading1',
    keywords: ['heading', 'title', 'h1'],
    apply: (editor, range) =>
      chainFrom(editor, range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'heading2',
    labelKey: 'noteView.slashMenu.heading2',
    keywords: ['heading', 'title', 'h2', 'subtitle'],
    apply: (editor, range) =>
      chainFrom(editor, range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'heading3',
    labelKey: 'noteView.slashMenu.heading3',
    keywords: ['heading', 'title', 'h3'],
    apply: (editor, range) =>
      chainFrom(editor, range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulletList',
    labelKey: 'noteView.slashMenu.bulletList',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    apply: (editor, range) => chainFrom(editor, range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    labelKey: 'noteView.slashMenu.orderedList',
    keywords: ['ordered', 'numbered', 'list', 'ol'],
    apply: (editor, range) => chainFrom(editor, range).toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    labelKey: 'noteView.slashMenu.blockquote',
    keywords: ['quote', 'blockquote', 'citation'],
    apply: (editor, range) => chainFrom(editor, range).toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    labelKey: 'noteView.slashMenu.codeBlock',
    keywords: ['code', 'codeblock', 'snippet', 'pre'],
    apply: (editor, range) => chainFrom(editor, range).setCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    labelKey: 'noteView.slashMenu.horizontalRule',
    keywords: ['divider', 'rule', 'separator', 'hr', 'line'],
    apply: (editor, range) => chainFrom(editor, range).setHorizontalRule().run(),
  },
];

/** Filter by `query` against each item's id and keywords, case-insensitively. Empty query → all. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.id.toLowerCase().includes(q) ||
      item.keywords.some((keyword) => keyword.includes(q)),
  );
}
