/** Plain-text extraction from an Entity's Content, for full-text search (ADR-0035). */

import { Content } from '../entity';
import { visit } from './content-node';

/** The Content's searchable prose. An unknown format tag yields `''`. */
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
