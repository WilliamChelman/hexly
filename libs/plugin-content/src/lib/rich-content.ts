/**
 * `core.rich-content` — prose as a **Structured Data Type** (CONTEXT.md → Structured Data Type,
 * ADR-0051). Every Type that means to carry prose declares the canonical {@link CONTENT_FIELD} at the
 * `content` key; a multi-type Entity resolves exactly one, since the effective set dedupes by key.
 *
 * The seam ADR-0019 named — the single place that knows the snapshot shape — has simply moved here: a
 * value's edges (its inline **Entity Links** and image Assets) and its searchable text come back
 * through the data-type the host registered, so the derive pass learns nothing about prose.
 */

import {
  assetHashFromUrl,
  defineField,
  defineStructuredDataType,
  descriptorSchema,
  type EntityEdge,
  type Field,
  type StructuredDataTypeId,
} from '@hexly/domain';
import { visit } from './content-node';
import { Content, contentSchema, emptyContent } from './content';
import { extractText } from './extract-text';

/** The `namespace.id` kind naming the prose data-type — what marks the `content` Field structured. */
export const CORE_RICH_CONTENT: StructuredDataTypeId = 'core.rich-content';

/**
 * The prose data-type's base capabilities, shared by both registrations. Its edges are the Content's
 * inline **Entity Links** (each carrying its `::` **Link Descriptor**) and the Assets its images embed;
 * its searchable text is the prose {@link extractText} collects. A format this build cannot read harvests
 * nothing rather than throwing — the forward-only tolerance a document at rest needs. Kept plain so
 * `rich-content-vault.ts` reuses it without re-listing the schema and walks (ADR-0051).
 */
export const richContentBase = {
  id: CORE_RICH_CONTENT,
  valueSchema: contentSchema,
  empty: emptyContent,
  harvestEdges: (content: Content): EntityEdge[] => {
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
  extractText: (content: Content) => extractText(content),
} as const;

/**
 * The prose data-type the **web** registers: the base plus its `body` projection slot, but no Markdown
 * converter — that toolchain rides the eager web bundle for no reason, since only a vault import/export
 * runs it. The converter lives on {@link RICH_CONTENT_DATA_TYPE_VAULT}, which only the API bundles (ADR-0051).
 */
export const RICH_CONTENT_DATA_TYPE = defineStructuredDataType({
  ...richContentBase,
  vault: { slot: 'body' },
});

/** The prose Field's reuse handle (ADR-0054) — its `id`, distinct from the `content` key it lenses. */
export const CONTENT_FIELD_ID = 'core.content';

/**
 * The canonical prose Field every Type that carries prose references by id (ADR-0051, ADR-0054):
 * `core.note`, `core.hexmap` beside its grid, `dnd.monster` beside its stats. The effective-set
 * resolver dedupes by `key`, so a multi-type Entity resolves exactly one.
 *
 * The header's View toggle reads its `labelKey` (a Structured Data Type's View being bound to the Field it
 * renders); the toggle moving onto the Field is the next ticket. Not `required`: an absent value opens
 * as an empty document and the first edit mints one. Never facetable — a document has no discrete
 * values to count.
 */
export const CONTENT_FIELD: Field = defineField({
  id: CONTENT_FIELD_ID,
  key: 'content',
  // The untranslated fallback; the web resolves `labelKey` through transloco.
  label: 'Content',
  labelKey: 'editor.view.content',
  dataType: { kind: CORE_RICH_CONTENT },
  required: false,
  facetable: false,
});
