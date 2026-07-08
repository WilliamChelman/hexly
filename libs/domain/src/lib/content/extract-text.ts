/**
 * Plain-text extraction from an Entity's Content, for full-text search (ADR-0035).
 * Dispatches on the format tag; an unknown format indexes as no prose.
 */

import { Content } from '../entity';
import { visit } from './content-node';

/**
 * Dispatch on the Content format tag and return its searchable prose. For any
 * `tiptap-*` format we collect every node's `text` — node-type-agnostic, so new
 * node types need no per-node handling. An unknown format tag yields `''`.
 */
export function extractText(content: Content): string {
  if (!content.format.startsWith('tiptap-')) return '';
  const parts: string[] = [];
  visit(content.snapshot, (node) => {
    if (typeof node.text === 'string') parts.push(node.text);
  });
  // Join with spaces then collapse runs: inline nodes carry their own spacing,
  // block nodes carry none — collapsing gives clean single-spaced text either way.
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
