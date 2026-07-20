/** Plain-text extraction from an Entity's RichContent, for full-text search (ADR-0035). */

import { joinSearchText } from '@hexly/domain';
import { RichContent } from './rich-content';
import { visit } from './content-node';

/** The Content's searchable prose. An unknown format tag yields `''`. */
export function extractText(content: RichContent): string {
  if (!content.format.startsWith('tiptap-')) return '';
  const parts: string[] = [];
  visit(content.snapshot, (node) => {
    if (typeof node.text === 'string') parts.push(node.text);
  });
  return joinSearchText(parts);
}
