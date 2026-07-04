/**
 * Harvest the Link Descriptors (#96, ADR-0023) an Entity's Content sets on its
 * `entityLink` nodes — the relationship labels ("spouse", "capital of") that feed
 * the owner's `::` vocabulary. Like {@link extractText} this reads inside Content
 * behind the format tag (ADR-0019/0035), but it is deliberately node-*specific*:
 * it knows the `entityLink` node and its `descriptor` attr, where the text extractor
 * stays node-agnostic. Server-derived on save so the vocabulary index tracks the
 * saved links, not a separately-computed client payload.
 */

import { Content } from './entity';

/** Distinct raw descriptors on every `entityLink` in the doc; `[]` for a non-tiptap format. Normalize (trim/lower/dedupe) with {@link descriptorsSchema} at the call site. */
export function harvestDescriptors(content: Content): string[] {
  if (!content.format.startsWith('tiptap-')) return [];
  const found = new Set<string>();
  collect(content.snapshot, found);
  return [...found];
}

function collect(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record['type'] === 'entityLink') {
      const attrs = record['attrs'] as Record<string, unknown> | undefined;
      const descriptor = attrs?.['descriptor'];
      if (typeof descriptor === 'string' && descriptor.trim()) found.add(descriptor);
    }
    collect(record['content'], found);
  }
}
