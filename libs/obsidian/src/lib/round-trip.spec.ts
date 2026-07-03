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
      out[k] = k === 'marks' && Array.isArray(v)
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
});
