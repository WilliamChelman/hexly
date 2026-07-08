/**
 * The heading Outline of an Entity's Content — derived, never stored. Knows the
 * `heading` node and its `level` attr, plus the `entityLink` atom's visible text,
 * so a heading made only of an @mention still lists.
 */

import { Content } from '../entity';
import { ContentNode, visit } from './content-node';
import { entityLinkText } from './entity-link';

/** One heading in document order: its raw level (1–6) and its concatenated text. */
export interface OutlineHeading {
  readonly level: number;
  readonly text: string;
}

/** Every `heading` in the Content, in document order; `[]` for a non-tiptap format. */
export function extractOutline(content: Content): OutlineHeading[] {
  if (!content.format.startsWith('tiptap-')) return [];
  const found: OutlineHeading[] = [];
  visit(content.snapshot, (node) => {
    if (node.type !== 'heading') return;
    const level = typeof node.attrs?.['level'] === 'number' ? (node.attrs['level'] as number) : 1;
    const text = headingText(node).trim();
    if (text) found.push({ level, text });
  });
  return found;
}

/**
 * Concatenate every `text` under a heading, plus an `entityLink` atom's rendered
 * text (`display ?? label`). The atom carries no `text` field but shows a name in
 * the DOM; skipping it would make a mention-only heading read as empty and slip the
 * Outline panel's positional index (row i ↔ i-th rendered heading).
 */
function headingText(heading: ContentNode): string {
  let text = '';
  visit(heading.content, (node) => {
    if (node.type === 'entityLink') text += entityLinkText(node.attrs);
    else if (typeof node.text === 'string') text += node.text;
  });
  return text;
}
