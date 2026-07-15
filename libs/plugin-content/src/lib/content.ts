/**
 * The Content value — format-tagged TipTap/ProseMirror JSON (ADR-0019, ADR-0051). Once the base body
 * shape, now the value of the `core.rich-content` **Structured Data Type**: a document with its own
 * schema, its own edges, and its own searchable text, stored at whatever key a Type declares it under.
 */

import { z } from 'zod';

/** The format tag new saves write; a schema-affecting extension change is a bump + migration. */
export const CONTENT_FORMAT = 'tiptap-v3';

/**
 * Formats a reader loads losslessly. Each bump is additive, so every earlier
 * version's docs round-trip untouched with no transform. Saves always write
 * CONTENT_FORMAT.
 */
export const READABLE_CONTENT_FORMATS = ['tiptap-v1', 'tiptap-v2', 'tiptap-v3'] as const;

/** Format-tagged Content; `snapshot` is `z.unknown()` so persistence stays format-agnostic — see ADR-0019. */
export const contentSchema = z.object({
  format: z.enum(READABLE_CONTENT_FORMATS),
  snapshot: z.unknown(),
});

export type Content = z.infer<typeof contentSchema>;

/** The one place a snapshot becomes Content — keeps callers from hand-stamping the format tag. */
export function tiptapContent(snapshot: unknown): Content {
  return { format: CONTENT_FORMAT, snapshot };
}

/** A fresh, empty document — what `core.rich-content`'s `empty()` mints for a Type that declares prose. */
export function emptyContent(): Content {
  return tiptapContent({ type: 'doc', content: [] });
}
