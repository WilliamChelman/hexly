/** Plain-text extraction from an Entity's Content, for full-text search (ADR-0035). */

import { Content } from '../entity';
import { joinSearchText } from '../join-search-text';
import { visit } from './content-node';

/** The Content's searchable prose. An unknown format tag yields `''`. */
export function extractText(content: Content): string {
  if (!content.format.startsWith('tiptap-')) return '';
  const parts: string[] = [];
  visit(content.snapshot, (node) => {
    if (typeof node.text === 'string') parts.push(node.text);
  });
  return joinSearchText(parts);
}
