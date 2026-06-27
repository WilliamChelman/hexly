import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { entityLinkNode } from './entity-link-node';

/**
 * The TipTap extension set — part of the format contract (ADR-0019). ProseMirror
 * JSON is schema-coupled: content for a node type not in this list is silently
 * dropped on load, so adding/removing a node or mark is a format bump + migration,
 * not a transparent edit. `entityLink` (ADR-0023) makes this set `tiptap-v2`.
 */
export const CONTENT_EXTENSIONS: Extensions = [StarterKit, entityLinkNode];
