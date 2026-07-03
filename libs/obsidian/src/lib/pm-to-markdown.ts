import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { stringify as stringifyYaml } from 'yaml';
import type { Root, RootContent, PhrasingContent, ListItem, BlockContent } from 'mdast';
import type { PMNode } from './markdown-to-pm';

const stringifier = unified()
  .use(remarkStringify, { bullet: '-', fences: true, rule: '-' })
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml']);

/**
 * Export: ProseMirror `tiptap-v3` JSON → Obsidian markdown (#145). The inverse of
 * {@link markdownToProseMirror}: faithful constructs round-trip; already-degraded
 * ones re-emit in their degraded form (e.g. an `entityLink` back to `[[wikilink]]`).
 * Optional `metadata` is re-emitted as YAML frontmatter.
 */
export function proseMirrorToMarkdown(
  doc: PMNode,
  metadata?: Record<string, unknown>
): string {
  const children = (doc.content ?? []).flatMap(blockToMdast);

  if (metadata && Object.keys(metadata).length) {
    children.unshift({ type: 'yaml', value: stringifyYaml(metadata).trimEnd() } as RootContent);
  }

  return unescapeObsidianTokens(stringifier.stringify({ type: 'root', children } as Root));
}

/**
 * remark-stringify escapes a leading `[` (it could begin a link), turning our
 * synthetic `[[wikilink]]`, `[!callout]`, and `[^footnote]` text back into `\[…`,
 * which Obsidian would render literally rather than as the construct. These escaped
 * sequences only ever originate from those tokens, so unescaping them is safe.
 */
function unescapeObsidianTokens(markdown: string): string {
  return markdown
    .replace(/\\\[\\\[/g, '[[')
    .replace(/\\\[!/g, '[!')
    .replace(/\\\[\^/g, '[^');
}

/** Maps a PM block node to mdast block content. */
function blockToMdast(node: PMNode): RootContent[] {
  switch (node.type) {
    case 'paragraph':
      return [{ type: 'paragraph', children: inlineChildren(node) }];
    case 'heading':
      return [
        {
          type: 'heading',
          depth: (node.attrs?.['level'] as 1 | 2 | 3 | 4 | 5 | 6) ?? 1,
          children: inlineChildren(node),
        },
      ];
    case 'bulletList':
      return [{ type: 'list', ordered: false, children: listItems(node) }];
    case 'orderedList':
      return [
        { type: 'list', ordered: true, start: (node.attrs?.['start'] as number) ?? 1, children: listItems(node) },
      ];
    case 'taskList':
      return [
        {
          type: 'list',
          ordered: false,
          children: (node.content ?? []).map((item) => ({
            type: 'listItem' as const,
            checked: Boolean(item.attrs?.['checked']),
            children: blockChildren(item),
          })) as ListItem[],
        },
      ];
    case 'codeBlock':
      return [
        {
          type: 'code',
          lang: (node.attrs?.['language'] as string) ?? null,
          value: node.content?.[0]?.text ?? '',
        },
      ];
    case 'blockquote':
      return [{ type: 'blockquote', children: blockChildren(node) }];
    case 'callout':
      return [calloutToMdast(node)];
    case 'horizontalRule':
      return [{ type: 'thematicBreak' }];
    case 'image':
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: (node.attrs?.['src'] as string) ?? '',
              alt: (node.attrs?.['alt'] as string) ?? null,
              title: (node.attrs?.['title'] as string) ?? null,
            },
          ],
        },
      ];
    case 'table':
      return [tableToMdast(node)];
    default:
      return [];
  }
}

/** Maps PM listItem children to mdast listItems. */
function listItems(node: PMNode): ListItem[] {
  return (node.content ?? []).map((item) => ({
    type: 'listItem',
    children: blockChildren(item),
  })) as ListItem[];
}

/** Maps a PM parent's block children to mdast block content. */
function blockChildren(node: PMNode): BlockContent[] {
  return (node.content ?? []).flatMap(blockToMdast) as BlockContent[];
}

/** Rebuilds an Obsidian callout as a blockquote whose first line is `[!type] Title`. */
function calloutToMdast(node: PMNode): RootContent {
  const type = (node.attrs?.['type'] as string) ?? 'note';
  const title = node.attrs?.['title'] as string | null;
  const header = `[!${type}]${title ? ` ${title}` : ''}`;
  return {
    type: 'blockquote',
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: header }] },
      ...blockChildren(node),
    ],
  };
}

/** Rebuilds a GFM table; the first PM row (tableHeader cells) becomes the header. */
function tableToMdast(node: PMNode): RootContent {
  return {
    type: 'table',
    children: (node.content ?? []).map((row) => ({
      type: 'tableRow',
      children: (row.content ?? []).map((cell) => ({
        type: 'tableCell',
        children: inlineChildren(cell.content?.[0] ?? { type: 'paragraph' }),
      })),
    })),
  } as RootContent;
}

/** Maps a PM parent's inline children to mdast phrasing content. */
function inlineChildren(node: PMNode): PhrasingContent[] {
  return (node.content ?? []).flatMap(inlineToMdast);
}

/** Maps a PM inline node to mdast phrasing content. */
function inlineToMdast(node: PMNode): PhrasingContent[] {
  switch (node.type) {
    case 'text':
      return [textToMdast(node)];
    case 'entityLink':
      return [{ type: 'text', value: entityLinkToWikilink(node) }];
    case 'hardBreak':
      return [{ type: 'break' }];
    default:
      return [];
  }
}

/** Rebuilds `[[label#heading|display]]` from an entityLink atom's attrs. */
function entityLinkToWikilink(node: PMNode): string {
  const label = (node.attrs?.['label'] as string) ?? '';
  const heading = node.attrs?.['heading'] as string | null;
  const display = node.attrs?.['display'] as string | null;
  return `[[${label}${heading ? `#${heading}` : ''}${display ? `|${display}` : ''}]]`;
}

/**
 * Rebuilds the mdast phrasing for a marked PM text node. `code` becomes inlineCode
 * and `highlight` re-wraps in `==…==` (no mdast node); emphasis/strong/delete/link
 * nest outward. The inverse of the import mark-carrying walker.
 */
function textToMdast(node: PMNode): PhrasingContent {
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  const value = marks.has('highlight') ? `==${node.text ?? ''}==` : node.text ?? '';

  let leaf: PhrasingContent = marks.has('code')
    ? { type: 'inlineCode', value }
    : { type: 'text', value };

  if (marks.has('strike')) leaf = { type: 'delete', children: [leaf] };
  if (marks.has('italic')) leaf = { type: 'emphasis', children: [leaf] };
  if (marks.has('bold')) leaf = { type: 'strong', children: [leaf] };

  const link = (node.marks ?? []).find((m) => m.type === 'link');
  if (link) leaf = { type: 'link', url: String(link.attrs?.['href'] ?? ''), children: [leaf] };

  return leaf;
}
