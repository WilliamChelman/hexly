import type { Editor } from '@tiptap/core';

/**
 * One control in the Content editor's formatting bubble menu (#74). `labelKey` is a
 * Transloco key (copy is client-owned, ADR-0014) used as the button's tooltip/aria-label;
 * `glyph` is its compact visual; `isActive` reflects the mark/node at the selection so the
 * control can light up; `run` toggles it on the current selection via TipTap commands.
 *
 * Every mark and node here is already in {@link CONTENT_EXTENSIONS} (StarterKit), so toggling
 * one needs no format bump and round-trips through the opaque snapshot for free (ADR-0019).
 */
export interface FormatItem {
  id: string;
  labelKey: string;
  glyph: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

export const FORMAT_ITEMS: FormatItem[] = [
  {
    id: 'bold',
    labelKey: 'noteView.formatMenu.bold',
    glyph: 'B',
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    labelKey: 'noteView.formatMenu.italic',
    glyph: 'I',
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: 'underline',
    labelKey: 'noteView.formatMenu.underline',
    glyph: 'U',
    isActive: (editor) => editor.isActive('underline'),
    run: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    id: 'strike',
    labelKey: 'noteView.formatMenu.strike',
    glyph: 'S',
    isActive: (editor) => editor.isActive('strike'),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    labelKey: 'noteView.formatMenu.code',
    glyph: '</>',
    isActive: (editor) => editor.isActive('code'),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `heading${level}`,
    labelKey: `noteView.formatMenu.heading${level}`,
    glyph: `H${level}`,
    isActive: (editor: Editor) => editor.isActive('heading', { level }),
    run: (editor: Editor) => editor.chain().focus().toggleHeading({ level }).run(),
  })),
  {
    id: 'bulletList',
    labelKey: 'noteView.formatMenu.bulletList',
    glyph: '•',
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    labelKey: 'noteView.formatMenu.orderedList',
    glyph: '1.',
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
];

/**
 * Link lives outside {@link FORMAT_ITEMS} because it needs a URL, not a bare toggle —
 * the bubble menu reveals a small input and calls these. The `link` mark is StarterKit's,
 * so it round-trips like every other mark (ADR-0019).
 */
export const isLinkActive = (editor: Editor): boolean => editor.isActive('link');

export const applyLink = (editor: Editor, href: string): void => {
  editor.chain().focus().setLink({ href }).run();
};

export const clearLink = (editor: Editor): void => {
  editor.chain().focus().unsetLink().run();
};
