import type { Editor } from '@tiptap/core';

/**
 * One control in the Content editor's formatting bubble menu. `labelKey` is a Transloco key
 * (copy is client-owned, ADR-0014) used as tooltip/aria-label; `isActive` reflects the
 * mark/node at the selection; `run` toggles it there.
 *
 * Every mark and node here must already be in {@link CONTENT_EXTENSIONS} (StarterKit), so no
 * format bump is needed and it round-trips through the opaque snapshot (ADR-0019).
 */
export interface FormatItem {
  id: string;
  labelKey: string;
  glyph: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => boolean;
}

export const FORMAT_ITEMS: FormatItem[] = [
  {
    id: 'bold',
    labelKey: 'editor.formatMenu.bold',
    glyph: 'B',
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    labelKey: 'editor.formatMenu.italic',
    glyph: 'I',
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'underline',
    labelKey: 'editor.formatMenu.underline',
    glyph: 'U',
    isActive: (editor) => editor.isActive('underline'),
    run: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    id: 'strike',
    labelKey: 'editor.formatMenu.strike',
    glyph: 'S',
    isActive: (editor) => editor.isActive('strike'),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    labelKey: 'editor.formatMenu.code',
    glyph: '</>',
    isActive: (editor) => editor.isActive('code'),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    // The `highlight` mark (ADR-0033) — `==text==` in Obsidian.
    id: 'highlight',
    labelKey: 'editor.formatMenu.highlight',
    glyph: '▍',
    isActive: (editor) => editor.isActive('highlight'),
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `heading${level}`,
    labelKey: `editor.slashMenu.heading${level}`,
    glyph: `H${level}`,
    isActive: (editor: Editor) => editor.isActive('heading', { level }),
    run: (editor: Editor) => editor.chain().focus().toggleHeading({ level }).run(),
  })),
  {
    id: 'bulletList',
    labelKey: 'editor.slashMenu.bulletList',
    glyph: '•',
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    labelKey: 'editor.slashMenu.orderedList',
    glyph: '1.',
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
];

/** Link lives outside {@link FORMAT_ITEMS} because it needs a URL, not a bare toggle. */
export const isLinkActive = (editor: Editor): boolean => editor.isActive('link');

export const applyLink = (editor: Editor, href: string): boolean => editor.chain().focus().setLink({ href }).run();

export const clearLink = (editor: Editor): void => {
  editor.chain().focus().unsetLink().run();
};
