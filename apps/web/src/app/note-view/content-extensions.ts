import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

/**
 * The TipTap extension set — part of the `tiptap-v1` format contract (ADR-0019).
 * ProseMirror JSON is schema-coupled: content for a node type not in this list is
 * silently dropped on load, so adding/removing a node or mark is a format bump +
 * migration, not a transparent edit.
 */
export const CONTENT_EXTENSIONS: Extensions = [StarterKit];
