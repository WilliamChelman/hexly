/**
 * Plain-text extraction from an Entity's Content, for full-text search. Format
 * knowledge is isolated here behind the format tag — the Entity model, storage,
 * and save/version logic never parse Content — so a new editor format means
 * registering one more arm, not touching the API.
 */

import { Content } from './entity';

/**
 * Dispatch on the Content format tag and return its searchable prose. For any
 * `tiptap-*` format we recursively collect every `text` field — node-type-
 * agnostic, so new node types need no per-node handling. An unknown format tag
 * yields `''` (indexed as no prose, not an error).
 */
export function extractText(content: Content): string {
  if (content.format.startsWith('tiptap-')) {
    // Join with spaces then collapse runs: inline nodes carry their own spacing,
    // block nodes carry none — collapsing gives clean single-spaced text either way.
    return collectText(content.snapshot).join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function collectText(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const here = typeof record['text'] === 'string' ? [record['text']] : [];
    return [...here, ...collectText(record['content'])];
  }
  return [];
}
