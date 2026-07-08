import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { parse as parseYaml } from 'yaml';
import type { Root, RootContent } from 'mdast';

/** A ProseMirror JSON node — the opaque `tiptap-v3` snapshot shape. */
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
 * Import: Obsidian markdown → ProseMirror `tiptap-v3` JSON. Pure — no HTTP,
 * DB, or entity resolution. Lossy by design: constructs with no native node degrade
 * to the nearest readable form and are tallied in `degraded`, never silently dropped.
 */
export function markdownToProseMirror(markdown: string): MarkdownToProseMirror {
  const tree = parser.parse(markdown) as Root;
  const degraded: Record<string, number> = {};

  const front = tree.children.find((n) => n.type === 'yaml');
  let metadata: Record<string, unknown> = {};
  if (front) {
    try {
      const parsed = parseYaml((front as { value: string }).value);
      // Frontmatter must be a key/value map. A top-level YAML list or scalar has no
      // Metadata shape — degrade it to empty rather than letting a non-object flow
      // downstream (where `{ ...meta }` would spread it into index-keyed junk).
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      } else if (parsed != null) {
        count(degraded, 'frontmatter');
      }
    } catch {
      // Malformed frontmatter degrades to empty metadata rather than crashing the import.
      count(degraded, 'frontmatter');
    }
  }

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
      return listToPM(node, degraded);
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
      // No PM node for this block (e.g. raw HTML) — tally it rather than drop it silently.
      count(degraded, node.type);
      return [];
  }
}

/**
 * Maps an mdast paragraph to PM blocks. The editor's `image` is a block node, so a
 * paragraph is split around any image node — a standard-markdown `![](…)` (an mdast image
 * child) or an Obsidian `![[media]]` embed (surfaced as an image node by the inline
 * tokenizer, {@link tokenToPM}). Text runs become paragraphs; each image becomes its own
 * block, in order.
 */
function paragraphToPM(
  node: Extract<RootContent, { type: 'paragraph' }>,
  degraded: Record<string, number>
): PMNode[] {
  // Assemble the full inline sequence first (mdast images become image nodes here; embed
  // images come from inlineToPM), then hoist every image node out to block level.
  const seq = node.children.flatMap((child) =>
    child.type === 'image'
      ? [{ type: 'image', attrs: { src: child.url, alt: child.alt ?? null, title: child.title ?? null } }]
      : inlineToPM(child, degraded, [])
  );

  const blocks: PMNode[] = [];
  let inline: PMNode[] = [];
  const flush = () => {
    if (inline.length) blocks.push({ type: 'paragraph', content: mergeAdjacentText(inline) });
    inline = [];
  };
  for (const n of seq) {
    if (n.type === 'image') {
      flush();
      blocks.push(n);
    } else {
      inline.push(n);
    }
  }
  flush();
  return blocks;
}

/** The Obsidian callout marker prefix: `[!type]` with an optional fold marker. */
const CALLOUT_MARKER = /^\[!([^\]]+)\][+-]?[ \t]*/;

/** Flattens phrasing content into plain text, dropping any inline formatting. */
function flattenToText(nodes: RootContent[]): string {
  return nodes
    .map((n) =>
      n.type === 'text' || n.type === 'inlineCode'
        ? n.value
        : 'children' in n
          ? flattenToText(n.children as RootContent[])
          : ''
    )
    .join('');
}

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

  const marker = CALLOUT_MARKER.exec(lead.value);
  if (!marker) return null;
  const type = marker[1].trim().toLowerCase();

  // The header line may carry inline formatting (e.g. `**Title**`), spanning several
  // sibling nodes; walk them until the first literal newline to find where it ends.
  const afterMarker = lead.value.slice(marker[0].length);
  const remaining: RootContent[] = [
    ...(afterMarker ? [{ type: 'text' as const, value: afterMarker }] : []),
    ...first.children.slice(1),
  ];

  const headerLine: RootContent[] = [];
  const bodyLead: RootContent[] = [];
  let inHeader = true;
  for (const child of remaining) {
    if (inHeader && child.type === 'text' && child.value.includes('\n')) {
      const newline = child.value.indexOf('\n');
      if (newline > 0) headerLine.push({ type: 'text', value: child.value.slice(0, newline) });
      const rest = child.value.slice(newline + 1);
      if (rest) bodyLead.push({ type: 'text', value: rest });
      inHeader = false;
    } else if (inHeader) {
      headerLine.push(child);
    } else {
      bodyLead.push(child);
    }
  }

  const title = flattenToText(headerLine).trim() || null;

  const body: PMNode[] = [];
  if (bodyLead.length) {
    body.push(...blockToPM({ type: 'paragraph', children: bodyLead } as RootContent, degraded));
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

/**
 * Maps an mdast list to PM list nodes. GFM lets one list mix plain `-` items and
 * `- [ ]` task items, but PM's bulletList/taskList can't mix, so each consecutive
 * run of the same kind becomes its own sibling list — a plain item next to a task
 * stays a bullet rather than a stray checkbox.
 */
function listToPM(
  node: Extract<RootContent, { type: 'list' }>,
  degraded: Record<string, number>
): PMNode[] {
  const out: PMNode[] = [];
  let run: typeof node.children = [];
  let runIsTask = false;
  // Items emitted so far. A split ordered list must keep counting across runs, so a plain
  // run after a task run continues the source numbering (`3.`) instead of restarting at `1.`.
  let consumed = 0;
  const flush = () => {
    if (!run.length) return;
    if (runIsTask) {
      out.push({
        type: 'taskList',
        content: run.map((item) => ({
          type: 'taskItem',
          attrs: { checked: item.checked === true },
          content: item.children.flatMap((child) => blockToPM(child, degraded)),
        })),
      });
    } else {
      const items: PMNode[] = run.map((item) => ({
        type: 'listItem',
        content: item.children.flatMap((child) => blockToPM(child, degraded)),
      }));
      out.push(
        node.ordered
          ? { type: 'orderedList', attrs: { start: (node.start ?? 1) + consumed }, content: items }
          : { type: 'bulletList', content: items }
      );
    }
    consumed += run.length;
    run = [];
  };
  for (const item of node.children) {
    const isTask = item.checked != null;
    if (run.length && isTask !== runIsTask) flush();
    runIsTask = isTask;
    run.push(item);
  }
  flush();
  return out;
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
  const nodes = parent.children.flatMap((child) => inlineToPM(child, degraded, marks));
  return mergeAdjacentText(nodes.flatMap((n) => inlineOnly(n, marks, degraded)));
}

/**
 * Coerce a node into valid inline content. Only {@link paragraphToPM} hoists a block `image`
 * node to block level; reached here (a heading, a table cell, or inside a mark) an `![[media]]`
 * embed can't be a block image without breaking the editor schema, so it degrades to a plain
 * link — the same fallback a non-media `![[…]]` embed already takes. Everything else passes through.
 */
function inlineOnly(node: PMNode, marks: Mark[], degraded: Record<string, number>): PMNode[] {
  if (node.type !== 'image') return [node];
  count(degraded, 'embed');
  const src = String(node.attrs?.['src'] ?? '');
  return [withMarks({ type: 'text', text: src }, [...marks, { type: 'link', attrs: { href: src } }])];
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
    if (node.type === 'text' && prev?.type === 'text' && sameMarks(prev.marks, node.marks)) {
      prev.text = (prev.text ?? '') + (node.text ?? '');
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Compares two mark sets for equality regardless of order. */
function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const marksA = a ?? [];
  const marksB = b ?? [];
  if (marksA.length !== marksB.length) return false;
  const key = (m: Mark) => JSON.stringify(m);
  const sortedA = marksA.map(key).sort();
  const sortedB = marksB.map(key).sort();
  return sortedA.every((m, i) => m === sortedB[i]);
}

/**
 * Obsidian's non-standard inline constructs have no mdast node, so they survive in
 * plain-text values. This scanner splits a text value around them: `==x==` becomes a
 * highlight-marked run; the surrounding text stays plain. Wikilinks and the degrading
 * constructs (comments, math) extend the same token regex.
 */
// Inline `$…$` requires non-space at both ends and no trailing digit, per Obsidian —
// so ordinary prose with two dollar amounts (`$5 and $10`) isn't mistaken for math.
const INLINE_TOKEN =
  /(!?)\[\[([^\]\n]+)\]\]|==(.+?)==|%%([\s\S]*?)%%|\$\$([\s\S]+?)\$\$|\$(\S|\S[^$\n]*?\S)\$(?!\d)/;

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

/**
 * Extensions Obsidian embeds as media rather than as a note transclusion. An
 * `![[X]]` whose target ends in one of these is an Asset the importer stores; anything else
 * (a bare note name) stays a degraded link. This is the source of truth the API's asset MIME
 * map must cover — a parity test in the API asserts the two lists agree, so drift fails CI.
 */
export const ASSET_EMBED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf'];
const ASSET_EMBED_EXT = new RegExp(`\\.(${ASSET_EMBED_EXTENSIONS.join('|')})$`, 'i');

/** Is this `![[target]]` an embedded media Asset (vs. a note transclusion)? */
function isAssetEmbed(target: string): boolean {
  return ASSET_EMBED_EXT.test(target);
}

/** Converts one matched {@link INLINE_TOKEN} into its PM node(s). */
function tokenToPM(m: RegExpExecArray, marks: Mark[], degraded: Record<string, number>): PMNode[] {
  const [, bang, wikilink, highlight, comment, blockMath, inlineMath] = m;

  if (wikilink !== undefined) {
    if (bang === '!') {
      // `![[media.ext]]` is an embedded Asset — surface it as a block image node (src = the
      // vault path) so the importer can store it; the `|size`/alias part is dropped.
      const target = wikilink.split('|', 1)[0].trim();
      if (isAssetEmbed(target)) {
        return [{ type: 'image', attrs: { src: target, alt: null, title: null } }];
      }
      // A non-media embed (`![[Some Note]]`) has no native node — degrade to a plain link.
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

/**
 * Parses `Target#heading|display` inner text into an `entityLink` atom (entityId
 * unresolved). `display` and `heading` are the trailing fields, so each splits on
 * only the *first* delimiter and keeps any further `|`/`#` as part of its value.
 */
function wikilinkToEntityLink(inner: string): PMNode {
  const pipe = inner.indexOf('|');
  const target = pipe === -1 ? inner : inner.slice(0, pipe);
  const display = pipe === -1 ? null : inner.slice(pipe + 1);

  const hash = target.indexOf('#');
  const label = hash === -1 ? target : target.slice(0, hash);
  const heading = hash === -1 ? null : target.slice(hash + 1);

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
      // No PM node for this inline (e.g. raw HTML) — tally it rather than drop it silently.
      count(degraded, node.type);
      return [];
  }
}
