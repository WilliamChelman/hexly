/**
 * `core.rich-content` — prose as a **Structured Field** data-type (CONTEXT.md → Structured Field,
 * ADR-0051). Every Type that means to carry prose declares the canonical {@link CONTENT_FIELD} at the
 * `content` key; a multi-type Entity resolves exactly one, since `resolveFields` dedupes by key.
 *
 * The seam ADR-0019 named — the single place that knows the snapshot shape — has simply moved here: a
 * value's edges (its inline **Entity Links** and image Assets) and its searchable text come back
 * through the data-type the host registered, so the derive pass learns nothing about prose.
 */

import {
  assetHashFromUrl,
  defineStructuredDataType,
  descriptorSchema,
  type EntityEdge,
  type FieldSchema,
  type StructuredDataTypeId,
  type VaultExportContext,
  type VaultImportContext,
} from '@hexly/domain';
import { ContentNode, visit } from './content-node';
import { Content, contentSchema, emptyContent, tiptapContent } from './content';
import { extractText } from './extract-text';
import { markdownToProseMirror } from './markdown-to-prose-mirror';
import { proseMirrorToMarkdown } from './prose-mirror-to-markdown';

/** The `namespace.id` kind naming the prose data-type — what marks the `content` Field structured. */
export const CORE_RICH_CONTENT: StructuredDataTypeId = 'core.rich-content';

/**
 * The prose data-type. Its edges are the Content's inline **Entity Links** (each carrying its `::`
 * **Link Descriptor**) and the Assets its images embed; its searchable text is the prose the
 * {@link extractText} walk collects. A Content format this build cannot read harvests nothing rather
 * than throwing — the forward-only tolerance a document at rest needs.
 */
export const RICH_CONTENT_DATA_TYPE = defineStructuredDataType({
  id: CORE_RICH_CONTENT,
  valueSchema: contentSchema,
  empty: emptyContent,
  harvestEdges: (content) => {
    const edges: EntityEdge[] = [];
    if (!content.format.startsWith('tiptap-')) return edges;
    visit(content.snapshot, (node) => {
      if (node.type === 'entityLink') {
        const entityId = node.attrs?.['entityId'];
        if (typeof entityId !== 'string') return;
        // A blank or absent descriptor is no descriptor — the same edge as an unadorned link.
        edges.push({
          targetKind: 'entity',
          targetId: entityId,
          descriptor: descriptorSchema.safeParse(node.attrs?.['descriptor']).data ?? null,
        });
        return;
      }
      if (node.type === 'image') {
        const src = node.attrs?.['src'];
        const hash = typeof src === 'string' ? assetHashFromUrl(src) : null;
        if (hash) edges.push({ targetKind: 'asset', targetId: hash, descriptor: null });
      }
    });
    return edges;
  },
  extractText: (content) => extractText(content),
  // The prose projects to the Markdown **body** (CONTEXT.md → Vault Projection, ADR-0051). The
  // converters that used to live in `libs/obsidian` are this projection now, so the vault layer reaches
  // Markdown↔ProseMirror through the data-type instead of importing the plugin.
  vault: {
    slot: 'body',
    toMarkdown: proseToBody,
    fromMarkdown: bodyToProse,
  },
});

/**
 * Serialize a Content value to its Markdown body block. Works on a clone so the stored snapshot is never
 * mutated: each inline **Entity Link**'s wikilink label is refreshed to its target's CURRENT name (so a
 * post-import rename still round-trips) and each image src is repointed at its exported Asset path — both
 * resolved through the {@link VaultExportContext}, never a DB the converter can't reach. A value this
 * build cannot read as Content serializes as an empty document rather than throwing.
 */
function proseToBody(content: Content | undefined, ctx: VaultExportContext): string {
  const snapshot = structuredClone(content?.snapshot ?? { type: 'doc', content: [] }) as ContentNode;
  visit(snapshot, (node) => {
    if (node.type === 'entityLink' && node.attrs) {
      const current = ctx.entityName(String(node.attrs['entityId'] ?? ''));
      if (current) node.attrs['label'] = current;
    } else if (node.type === 'image' && node.attrs) {
      const mapped = ctx.assetPath(String(node.attrs['src'] ?? ''));
      if (mapped) node.attrs['src'] = mapped;
    }
  });
  return proseMirrorToMarkdown(snapshot);
}

/**
 * Parse a Markdown body block back into a Content value. Runs the pure {@link markdownToProseMirror}
 * converter, then resolves through the {@link VaultImportContext}: each `[[wikilink]]`'s label to an
 * `entityId` (a blank label is a same-note anchor — left unresolved and uncounted), each vault-relative
 * image src to its stored capability URL, and every construct with no native node reported as degraded.
 */
function bodyToProse(markdown: string, ctx: VaultImportContext): Content {
  const { doc, degraded } = markdownToProseMirror(markdown);
  for (const [construct, n] of Object.entries(degraded)) ctx.degrade(construct, n);
  visit(doc, (node) => {
    if (node.type === 'entityLink' && node.attrs) {
      const label = String(node.attrs['label'] ?? '');
      if (label) node.attrs['entityId'] = ctx.resolveLink(label);
    } else if (node.type === 'image' && node.attrs) {
      const url = ctx.storeAsset(String(node.attrs['src'] ?? ''));
      if (url) node.attrs['src'] = url;
    }
  });
  return tiptapContent(doc);
}

/**
 * The canonical prose Field every Type that carries prose declares (ADR-0051): `core.note` and nothing
 * else, `core.hexmap` beside its grid, `dnd.monster` beside its stats. `resolveFields` dedupes by key,
 * so a multi-type Entity resolves exactly one — no rule, no enforcement.
 *
 * The header's View toggle reads its `labelKey` (a Structured Field's View being bound to the Field it
 * renders); the toggle moving onto the Field is the next ticket. Not `required`: an absent value opens
 * as an empty document and the first edit mints one. Never facetable — a document has no discrete
 * values to count.
 */
export const CONTENT_FIELD: FieldSchema = Object.freeze({
  key: 'content',
  // The untranslated fallback; the web resolves `labelKey` through transloco.
  label: 'Content',
  labelKey: 'editor.view.content',
  dataType: { kind: CORE_RICH_CONTENT },
  required: false,
  facetable: false,
});
