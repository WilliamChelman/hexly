/**
 * Harvest the Link Descriptors an Entity's Content sets on its `entityLink`
 * nodes — the relationship labels ("spouse", "capital of") that feed the
 * owner's `::` vocabulary. Server-derived on save so the vocabulary index
 * tracks the saved links, not a separately-computed client payload.
 */

import { Content } from '../entity';
import { visit } from './content-node';

/** Distinct raw descriptors on every `entityLink` in the doc; `[]` for a non-tiptap format. Normalize (trim/lower/dedupe) with {@link descriptorsSchema} at the call site. */
export function harvestDescriptors(content: Content): string[] {
  if (!content.format.startsWith('tiptap-')) return [];
  const found = new Set<string>();
  visit(content.snapshot, (node) => {
    if (node.type !== 'entityLink') return;
    const descriptor = node.attrs?.['descriptor'];
    if (typeof descriptor === 'string' && descriptor.trim()) found.add(descriptor);
  });
  return [...found];
}
