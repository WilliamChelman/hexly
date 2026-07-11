import { markdownToProseMirror } from './markdown-to-pm';
import { proseMirrorToMarkdown } from './pm-to-markdown';

/**
 * The round-trip contract (#145): importing markdown, exporting it, and re-importing
 * must land on the identical ProseMirror doc. Faithful constructs survive; already-
 * degraded ones re-emit in their degraded form and are therefore stable on re-import.
 * We pin against the PM doc, never the intermediate markdown/AST string.
 */
/**
 * Mark order within a text node is not semantic (`**_x_**` ≡ `_**x**_`), and remark
 * normalizes the nesting on stringify. Sort marks by type so the round-trip pins
 * semantic equivalence, not incidental nesting order.
 */
function sortMarks(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sortMarks);
  if (node && typeof node === 'object') {
    const n = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      out[k] =
        k === 'marks' && Array.isArray(v)
          ? [...v].sort((a, b) => (a.type as string).localeCompare(b.type))
          : sortMarks(v);
    }
    return out;
  }
  return node;
}

function reimport(markdown: string) {
  const first = sortMarks(markdownToProseMirror(markdown).doc);
  const back = sortMarks(markdownToProseMirror(proseMirrorToMarkdown(markdownToProseMirror(markdown).doc)).doc);
  return { first, back };
}

describe('markdown → PM → markdown round-trip', () => {
  it.each([
    ['paragraph', 'Hello world'],
    ['heading', '## Chapter One'],
    ['bold', 'a **b** c'],
    ['italic', 'a *b* c'],
    ['strikethrough', 'a ~~b~~ c'],
    ['inline code', 'a `b` c'],
    ['highlight', 'a ==b== c'],
    ['link', 'see [docs](https://x/docs)'],
    ['stacked marks', '**_bold italic_**'],
    ['bullet list', '- one\n- two'],
    ['ordered list', '1. first\n2. second'],
    ['task list', '- [x] done\n- [ ] todo'],
    ['code block', '```ts\nconst x = 1;\n```'],
    ['blockquote', '> quoted'],
    ['thematic break', 'a\n\n---\n\nb'],
    ['image', '![a cat](https://x/cat.png "Tabby")'],
    ['table', '| A | B |\n| - | - |\n| 1 | 2 |'],
    ['wikilink', '[[Alice]]'],
    ['wikilink display+heading', '[[Alice#Bio|Al]]'],
    ['callout', '> [!warning] Be careful\n> Body with [[Alice]].'],
    // Already-degraded constructs re-emit in their degraded form, so re-import is stable.
    ['embed → link', '![[Some Note]]'],
    ['math → code', 'mass $E=mc^2$ here'],
    ['mermaid → code block', '```mermaid\ngraph TD\n```'],
    ['hard break', 'line one\\\nline two'],
  ])('preserves the PM doc for %s', (_name, markdown) => {
    const { first, back } = reimport(markdown);
    expect(back).toEqual(first);
  });

  // A tight list must stay tight: remark defaults lists to loose, so without an explicit
  // per-item `spread` the export injects a blank line between every item (the PM-doc pin above
  // can't catch this — tight and loose parse to the same doc). Indentation normalizes to 2 spaces.
  it('exports a tight nested list without injecting blank lines between items', () => {
    const src = [
      '- Doors in the west wing are more likely to be locked',
      '- pomme = 2',
      '- 4 po >= 5 apples + 5 bannas + 5 oranges = 50 steps',
      '    - banne = 2 po = 3 steps',
      '    - orange = ? po = 5 steps',
      '- Drawing room',
      '    - femme 4',
      '    - homme canne 11',
      '    - cheval 6',
      '    - homme pp 15',
      '    - enfant 5',
    ].join('\n');
    const expected = [
      '- Doors in the west wing are more likely to be locked',
      '- pomme = 2',
      '- 4 po >= 5 apples + 5 bannas + 5 oranges = 50 steps',
      '  - banne = 2 po = 3 steps',
      '  - orange = ? po = 5 steps',
      '- Drawing room',
      '  - femme 4',
      '  - homme canne 11',
      '  - cheval 6',
      '  - homme pp 15',
      '  - enfant 5',
    ].join('\n');
    const back = proseMirrorToMarkdown(markdownToProseMirror(src).doc);
    expect(back.trimEnd()).toBe(expected);
  });

  // The flip side: a genuinely loose item (two paragraphs) must keep its blank line, or the two
  // paragraphs merge into one on reparse. Guards the tight-list fix from over-tightening.
  it('keeps a loose list item that has two paragraphs loose', () => {
    const src = '- item one\n\n  second paragraph of item one\n\n- item two';
    const back = proseMirrorToMarkdown(markdownToProseMirror(src).doc);
    expect(back).toContain('- item one\n\n  second paragraph of item one');
  });
});
