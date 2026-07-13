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
 * Export: ProseMirror `tiptap-v3` JSON → Obsidian markdown. The inverse of
 * {@link markdownToProseMirror}: faithful constructs round-trip; already-degraded
 * ones re-emit in their degraded form (e.g. an `entityLink` back to `[[wikilink]]`).
 * Optional `metadata` is re-emitted as YAML frontmatter.
 */
export function proseMirrorToMarkdown(doc: PMNode, metadata?: Record<string, unknown>): string {
  const children = (doc.content ?? []).flatMap(blockToMdast);

  if (metadata && Object.keys(metadata).length) {
    children.unshift({
      type: 'yaml',
      value: stringifyYaml(metadata).trimEnd(),
    } as RootContent);
  }

  return unescapeObsidianTokens(stringifier.stringify({ type: 'root', children } as Root));
}

/**
 * remark-stringify escapes every literal `[` in text (it could begin a link), with
 * no way to tell our synthetic `[[wikilink]]`/`[!callout]` brackets apart from a
 * user's own literal `[[...]]` text — blanket-unescaping would revive the latter as
 * live Obsidian syntax. {@link RAW_MARK} tags the brackets *we* emit (in
 * {@link entityLinkToWikilink} and {@link calloutToMdast}) with an invisible marker
 * that survives stringification; only those tagged, escaped brackets are unescaped
 * here, leaving any coincidentally-identical user text alone.
 */
const RAW_MARK = '⁣';

function unescapeObsidianTokens(markdown: string): string {
  return markdown.replaceAll(`${RAW_MARK}\\[`, '[');
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
    case 'bulletList': {
      const children = listItems(node);
      return [
        {
          type: 'list',
          ordered: false,
          spread: listSpread(children),
          children,
        },
      ];
    }
    case 'orderedList': {
      const children = listItems(node);
      return [
        {
          type: 'list',
          ordered: true,
          start: (node.attrs?.['start'] as number) ?? 1,
          spread: listSpread(children),
          children,
        },
      ];
    }
    case 'taskList': {
      const children = (node.content ?? []).map((item) => {
        const itemChildren = blockChildren(item);
        return {
          type: 'listItem' as const,
          checked: Boolean(item.attrs?.['checked']),
          spread: itemSpread(itemChildren),
          children: itemChildren,
        };
      }) as ListItem[];
      return [
        {
          type: 'list',
          ordered: false,
          spread: listSpread(children),
          children,
        },
      ];
    }
    case 'codeBlock':
      return [
        {
          type: 'code',
          lang: (node.attrs?.['language'] as string) ?? null,
          value: (node.content ?? []).map((child) => child.text ?? '').join(''),
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

/** Maps PM listItem children to mdast listItems, tagging each with its looseness. */
function listItems(node: PMNode): ListItem[] {
  return (node.content ?? []).map((item) => {
    const children = blockChildren(item);
    return { type: 'listItem', spread: itemSpread(children), children };
  }) as ListItem[];
}

/**
 * mdast list looseness. PM has no tight/loose flag, so we derive one: an item is "spread"
 * (rendered with blank lines around its later blocks) only when two of its paragraphs are adjacent
 * and would otherwise merge into one on reparse — a paragraph followed by a nested list stays tight.
 * A list is loose iff any item is, matching CommonMark. Without this, remark defaults every list to
 * loose and a tight source list gains a blank line between every item on round-trip.
 */
function itemSpread(children: BlockContent[]): boolean {
  return children.some((c, i) => i > 0 && c.type === 'paragraph' && children[i - 1].type === 'paragraph');
}

function listSpread(items: ListItem[]): boolean {
  return items.some((item) => item.spread === true);
}

/** Maps a PM parent's block children to mdast block content. */
function blockChildren(node: PMNode): BlockContent[] {
  return (node.content ?? []).flatMap(blockToMdast) as BlockContent[];
}

/** Rebuilds an Obsidian callout as a blockquote whose first line is `[!type] Title`. */
function calloutToMdast(node: PMNode): RootContent {
  const type = (node.attrs?.['type'] as string) ?? 'note';
  const title = node.attrs?.['title'] as string | null;
  const header = `${RAW_MARK}[!${type}]${title ? ` ${title}` : ''}`;
  return {
    type: 'blockquote',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: header }] }, ...blockChildren(node)],
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
        children: cellToPhrasing(cell),
      })),
    })),
  } as RootContent;
}

/**
 * A markdown table cell holds one line of phrasing content; a PM cell with more than
 * one block (the editor's table cells are `block+`) degrades to that one line, with
 * blocks joined by a space rather than losing every block after the first.
 */
function cellToPhrasing(cell: PMNode): PhrasingContent[] {
  const blocks = cell.content?.length ? cell.content : [{ type: 'paragraph' }];
  return blocks.flatMap((block, i) =>
    i === 0 ? inlineChildren(block) : [{ type: 'text', value: ' ' } as PhrasingContent, ...inlineChildren(block)],
  );
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
  return `${RAW_MARK}[${RAW_MARK}[${label}${heading ? `#${heading}` : ''}${display ? `|${display}` : ''}]]`;
}

/**
 * Rebuilds the mdast phrasing for a marked PM text node. `highlight` has no mdast node, so it
 * re-wraps in literal `==…==`; emphasis/strong/delete/link nest outward.
 */
function textToMdast(node: PMNode): PhrasingContent {
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  const value = marks.has('highlight') ? `==${node.text ?? ''}==` : (node.text ?? '');

  let leaf: PhrasingContent = marks.has('code') ? { type: 'inlineCode', value } : { type: 'text', value };

  if (marks.has('strike')) leaf = { type: 'delete', children: [leaf] };
  if (marks.has('italic')) leaf = { type: 'emphasis', children: [leaf] };
  if (marks.has('bold')) leaf = { type: 'strong', children: [leaf] };

  const link = (node.marks ?? []).find((m) => m.type === 'link');
  if (link)
    leaf = {
      type: 'link',
      url: String(link.attrs?.['href'] ?? ''),
      children: [leaf],
    };

  return leaf;
}
