/**
 * The heading Outline of an Entity's Content — the derived, never-stored
 * navigation tree behind the format tag (ADR-0019/0035), a sibling to
 * {@link extractText}. Node-*specific* like {@link harvestDescriptors}: it knows
 * the `heading` node and its `level` attr, plus the `entityLink` atom's visible
 * text (its `display`/`label`) — so a heading made only of an @mention still lists.
 * Client-derived live from the editor
 * for the Outline panel; the domain keeps no heading model of its own.
 */

import { Content } from './entity';

/** One heading in document order: its raw level (1–6) and its concatenated text. */
export interface OutlineHeading {
  readonly level: number;
  readonly text: string;
}

/** Every `heading` in the Content, in document order; `[]` for a non-tiptap format. */
export function extractOutline(content: Content): OutlineHeading[] {
  if (!content.format.startsWith('tiptap-')) return [];
  const found: OutlineHeading[] = [];
  collect(content.snapshot, found);
  return found;
}

function collect(node: unknown, found: OutlineHeading[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record['type'] === 'heading') {
      const attrs = record['attrs'] as Record<string, unknown> | undefined;
      const level = typeof attrs?.['level'] === 'number' ? (attrs['level'] as number) : 1;
      const text = headingText(record['content']).trim();
      if (text) found.push({ level, text });
    }
    collect(record['content'], found);
  }
}

/**
 * Concatenate every `text` field under a heading — spans (bold, etc.) included —
 * plus an `entityLink` atom's rendered text (`display ?? label`, mirroring the node's
 * own renderHTML). The atom carries no `text` field but shows a name in the DOM, so
 * without this a mention-only heading reads as empty here while its `<h*>` does not —
 * and the panel's positional index (extractOutline row i ↔ i-th rendered heading)
 * would slip, jumping and highlighting the wrong heading.
 */
function headingText(node: unknown): string {
  if (Array.isArray(node)) return node.map(headingText).join('');
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record['type'] === 'entityLink') {
      const attrs = record['attrs'] as Record<string, unknown> | undefined;
      const shown = attrs?.['display'] ?? attrs?.['label'];
      // ponytail: if both are null (link inserted before its name resolved) the DOM
      // may still show a live-resolved name — rare, unresolved-only; revisit if it bites.
      return typeof shown === 'string' ? shown : '';
    }
    const here = typeof record['text'] === 'string' ? (record['text'] as string) : '';
    return here + headingText(record['content']);
  }
  return '';
}
