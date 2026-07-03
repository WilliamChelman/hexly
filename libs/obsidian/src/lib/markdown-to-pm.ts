import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { parse as parseYaml } from 'yaml';
import type { Root, RootContent } from 'mdast';

/** A ProseMirror JSON node — the opaque `tiptap-v3` snapshot shape (ADR-0019/0033). */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface MarkdownToProseMirror {
  doc: PMNode;
  metadata: Record<string, unknown>;
  degraded: Record<string, number>;
}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml']);

/**
 * Import: Obsidian markdown → ProseMirror `tiptap-v3` JSON (#145). Pure — no HTTP,
 * DB, or entity resolution. Lossy by design: constructs with no native node degrade
 * to the nearest readable form and are tallied in `degraded`, never silently dropped.
 */
export function markdownToProseMirror(markdown: string): MarkdownToProseMirror {
  const tree = parser.parse(markdown) as Root;
  const degraded: Record<string, number> = {};

  const front = tree.children.find((n) => n.type === 'yaml');
  const metadata = front ? (parseYaml((front as { value: string }).value) ?? {}) : {};

  const content = tree.children
    .filter((node) => node.type !== 'yaml')
    .flatMap((node) => blockToPM(node, degraded));

  return { doc: { type: 'doc', content }, metadata, degraded };
}

/** Maps an mdast block node to zero or more PM block nodes. */
function blockToPM(node: RootContent, degraded: Record<string, number>): PMNode[] {
  switch (node.type) {
    case 'paragraph':
      return paragraphToPM(node, degraded);
    case 'heading':
      return [
        {
          type: 'heading',
          attrs: { level: node.depth },
          content: inlineChildren(node, degraded),
        },
      ];
    case 'list':
      return [listToPM(node, degraded)];
    case 'code':
      // Mermaid has no native node; the fenced code block IS its nearest readable form.
      if (node.lang === 'mermaid') count(degraded, 'mermaid');
      return [
        {
          type: 'codeBlock',
          attrs: { language: node.lang ?? null },
          content: node.value ? [{ type: 'text', text: node.value }] : [],
        },
      ];
    case 'blockquote':
      return [
        calloutFromBlockquote(node, degraded) ?? {
          type: 'blockquote',
          content: node.children.flatMap((child) => blockToPM(child, degraded)),
        },
      ];
    case 'thematicBreak':
      return [{ type: 'horizontalRule' }];
    case 'table':
      return [tableToPM(node, degraded)];
    // A footnote definition has no native node; keep its prose as readable blocks.
    case 'footnoteDefinition':
      return node.children.flatMap((child) => blockToPM(child, degraded));
    default:
      return [];
  }
}

/**
 * Maps an mdast paragraph to PM blocks. The editor's `image` is a block node, so a
 * paragraph is split around any top-level images: text runs become paragraphs and
 * each image becomes its own block, in order.
 */
function paragraphToPM(
  node: Extract<RootContent, { type: 'paragraph' }>,
  degraded: Record<string, number>
): PMNode[] {
  const blocks: PMNode[] = [];
  let inline: PMNode[] = [];
  const flush = () => {
    if (inline.length) blocks.push({ type: 'paragraph', content: mergeAdjacentText(inline) });
    inline = [];
  };

  for (const child of node.children) {
    if (child.type === 'image') {
      flush();
      blocks.push({
        type: 'image',
        attrs: { src: child.url, alt: child.alt ?? null, title: child.title ?? null },
      });
    } else {
      inline.push(...inlineToPM(child, degraded, []));
    }
  }
  flush();
  return blocks;
}

/** The Obsidian callout header: `[!type]` with an optional fold marker and title. */
const CALLOUT_HEADER = /^\[!([^\]]+)\][+-]?[ \t]*([^\n]*)/;

/**
 * A callout is a blockquote whose first line is `[!type] Title`. Returns the PM
 * `callout` node (type + title + live block body), or null if the blockquote isn't
 * a callout — in which case the caller emits a plain blockquote.
 */
function calloutFromBlockquote(
  node: Extract<RootContent, { type: 'blockquote' }>,
  degraded: Record<string, number>
): PMNode | null {
  const first = node.children[0];
  if (first?.type !== 'paragraph') return null;
  const lead = first.children[0];
  if (lead?.type !== 'text') return null;

  const header = CALLOUT_HEADER.exec(lead.value);
  if (!header) return null;

  const type = header[1].trim().toLowerCase();
  const title = header[2].trim() || null;

  // The header shares its paragraph with any body on the next line; keep that body.
  const newline = lead.value.indexOf('\n');
  const remainder = newline === -1 ? '' : lead.value.slice(newline + 1);
  const leadSiblings = first.children.slice(1);

  const body: PMNode[] = [];
  const rebuiltLead: RootContent[] = [
    ...(remainder ? [{ type: 'text' as const, value: remainder }] : []),
    ...leadSiblings,
  ];
  if (rebuiltLead.length) {
    body.push(...blockToPM({ type: 'paragraph', children: rebuiltLead } as RootContent, degraded));
  }
  for (const child of node.children.slice(1)) body.push(...blockToPM(child, degraded));

  // `callout` content is `block+`; a bodyless callout still needs one block.
  if (!body.length) body.push({ type: 'paragraph' });

  return { type: 'callout', attrs: { type, title }, content: body };
}

/** Maps a GFM table to the PM table node set; the first row becomes header cells. */
function tableToPM(
  node: Extract<RootContent, { type: 'table' }>,
  degraded: Record<string, number>
): PMNode {
  return {
    type: 'table',
    content: node.children.map((row, rowIndex) => ({
      type: 'tableRow',
      content: row.children.map((cell) => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph', content: inlineChildren(cell, degraded) }],
      })),
    })),
  };
}

/** Maps an mdast list to a PM bulletList/orderedList of listItems. */
function listToPM(
  node: Extract<RootContent, { type: 'list' }>,
  degraded: Record<string, number>
): PMNode {
  const isTaskList = node.children.some((item) => item.checked != null);
  if (isTaskList) {
    return {
      type: 'taskList',
      content: node.children.map((item) => ({
        type: 'taskItem',
        attrs: { checked: item.checked === true },
        content: item.children.flatMap((child) => blockToPM(child, degraded)),
      })),
    };
  }

  const items: PMNode[] = node.children.map((item) => ({
    type: 'listItem',
    content: item.children.flatMap((child) => blockToPM(child, degraded)),
  }));

  return node.ordered
    ? { type: 'orderedList', attrs: { start: node.start ?? 1 }, content: items }
    : { type: 'bulletList', content: items };
}

type Mark = { type: string; attrs?: Record<string, unknown> };

/** The mdast inline wrapper → PM mark-name mapping for the mark-carrying walker. */
const MARK_FOR_NODE: Record<string, string> = {
  strong: 'bold',
  emphasis: 'italic',
  delete: 'strike',
};

/** Maps an mdast parent's inline children to PM inline nodes, normalized. */
function inlineChildren(
  parent: { children: RootContent[] },
  degraded: Record<string, number>,
  marks: Mark[] = []
): PMNode[] {
  return mergeAdjacentText(parent.children.flatMap((child) => inlineToPM(child, degraded, marks)));
}

/**
 * ProseMirror stores adjacent text with identical marks as a single node, so the
 * splitting the inline scanner and degradation do (e.g. a `[^1]` marker between two
 * plain runs) must be re-coalesced — otherwise exported→re-imported docs wouldn't match.
 */
function mergeAdjacentText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (
      node.type === 'text' &&
      prev?.type === 'text' &&
      JSON.stringify(prev.marks ?? null) === JSON.stringify(node.marks ?? null)
    ) {
      prev.text = (prev.text ?? '') + (node.text ?? '');
    } else {
      out.push(node);
    }
  }
  return out;
}

/**
 * Obsidian's non-standard inline constructs have no mdast node, so they survive in
 * plain-text values. This scanner splits a text value around them: `==x==` becomes a
 * highlight-marked run; the surrounding text stays plain. Wikilinks and the degrading
 * constructs (comments, math) extend the same token regex.
 */
const INLINE_TOKEN =
  /(!?)\[\[([^\]\n]+)\]\]|==(.+?)==|%%([\s\S]*?)%%|\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/;

/** Splits an mdast text value around Obsidian inline tokens into PM inline nodes. */
function splitInlineText(
  value: string,
  marks: Mark[],
  degraded: Record<string, number>
): PMNode[] {
  const out: PMNode[] = [];
  let rest = value;

  for (let m = INLINE_TOKEN.exec(rest); m; m = INLINE_TOKEN.exec(rest)) {
    if (m.index > 0) {
      out.push(withMarks({ type: 'text', text: rest.slice(0, m.index) }, marks));
    }
    out.push(...tokenToPM(m, marks, degraded));
    rest = rest.slice(m.index + m[0].length);
  }

  if (rest) out.push(withMarks({ type: 'text', text: rest }, marks));
  return out;
}

/** Converts one matched {@link INLINE_TOKEN} into its PM node(s). */
function tokenToPM(m: RegExpExecArray, marks: Mark[], degraded: Record<string, number>): PMNode[] {
  const [, bang, wikilink, highlight, comment, blockMath, inlineMath] = m;

  if (wikilink !== undefined) {
    // `![[X]]` embeds have no native node — degrade to a plain link (nearest readable).
    if (bang === '!') {
      count(degraded, 'embed');
      return [withMarks({ type: 'text', text: wikilink }, [...marks, { type: 'link', attrs: { href: wikilink } }])];
    }
    return [wikilinkToEntityLink(wikilink)];
  }

  if (highlight !== undefined) {
    return [withMarks({ type: 'text', text: highlight }, [...marks, { type: 'highlight' }])];
  }

  // Comments have no readable form — drop the text, but tally it (never silently lost).
  if (comment !== undefined) {
    count(degraded, 'comment');
    return [];
  }

  // Math has no native node — degrade to inline code (nearest readable) and tally.
  count(degraded, 'math');
  return [withMarks({ type: 'text', text: (blockMath ?? inlineMath).trim() }, [...marks, { type: 'code' }])];
}

/** Parses `Target#heading|display` inner text into an `entityLink` atom (entityId unresolved). */
function wikilinkToEntityLink(inner: string): PMNode {
  const [target, display = null] = inner.split('|');
  const [label, heading = null] = target.split('#');
  return {
    type: 'entityLink',
    attrs: { entityId: null, label: label.trim(), descriptor: null, display, heading },
  };
}

/** Bumps a per-construct degradation tally. */
function count(degraded: Record<string, number>, key: string): void {
  degraded[key] = (degraded[key] ?? 0) + 1;
}

/** Attaches the accumulated marks to a leaf text/inline PM node. */
function withMarks(node: PMNode, marks: Mark[]): PMNode {
  return marks.length ? { ...node, marks } : node;
}

/** Maps an mdast inline node to zero or more PM inline nodes, carrying marks down. */
function inlineToPM(
  node: RootContent,
  degraded: Record<string, number>,
  marks: Mark[]
): PMNode[] {
  switch (node.type) {
    case 'text':
      return splitInlineText(node.value, marks, degraded);
    case 'inlineCode':
      return [withMarks({ type: 'text', text: node.value }, [...marks, { type: 'code' }])];
    case 'break':
      return [{ type: 'hardBreak' }];
    case 'strong':
    case 'emphasis':
    case 'delete':
      return inlineChildren(node, degraded, [...marks, { type: MARK_FOR_NODE[node.type] }]);
    case 'link':
      return inlineChildren(node, degraded, [
        ...marks,
        { type: 'link', attrs: { href: node.url } },
      ]);
    // Footnotes have no native node — degrade the reference to a plain `[^id]` marker.
    case 'footnoteReference':
      count(degraded, 'footnote');
      return [withMarks({ type: 'text', text: `[^${node.identifier}]` }, marks)];
    default:
      return [];
  }
}
