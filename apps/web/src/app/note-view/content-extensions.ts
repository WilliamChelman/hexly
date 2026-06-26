import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

/**
 * The registered TipTap extension set — **part of the `tiptap-v1` Content format
 * contract** (ADR-0019). ProseMirror JSON is schema-coupled: content for a node
 * type not registered here is silently dropped on load. So this list is not a free
 * UI choice — changing it in a schema-affecting way (adding/removing a node or mark)
 * is a `format` bump + migration, not a transparent edit.
 *
 * `StarterKit` (v3) bundles the document/paragraph/text core plus the marks and
 * nodes this slice ships: headings, bullet/ordered lists, bold, italic, strike,
 * underline, code, blockquote, horizontal rule, hard break, and links. The slash
 * menu, formatting toolbar, and custom blocks (the hex-map and entity-reference
 * node views) are later slices that will extend this set behind the same contract.
 */
export const CONTENT_EXTENSIONS: Extensions = [StarterKit];
