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
} from '@hexly/domain';
import { visit } from './content-node';
import { Content, contentSchema, emptyContent } from './content';
import { extractText } from './extract-text';

/** The `namespace.id` kind naming the prose data-type — what marks the `content` Field structured. */
export const CORE_RICH_CONTENT: StructuredDataTypeId = 'core.rich-content';

/**
 * The prose data-type's base capabilities — schema, edge harvest, and searchable text — shared by both
 * its registrations. Its edges are the Content's inline **Entity Links** (each carrying its `::` **Link
 * Descriptor**) and the Assets its images embed; its searchable text is the prose the {@link extractText}
 * walk collects. A Content format this build cannot read harvests nothing rather than throwing — the
 * forward-only tolerance a document at rest needs.
 *
 * Kept as a plain definition so `rich-content-vault.ts` can reuse it without re-listing the schema and
 * the two walks: the Markdown converter is the *only* thing the two registrations differ by, and it is a
 * ~160 kB `unified`/`remark` toolchain the browser never runs (ADR-0051 — see {@link RICH_CONTENT_DATA_TYPE}).
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
 * The prose data-type as the **web** registers it (ADR-0051): the base above plus its `body` projection
 * *slot*, but **no Markdown converter**. Markdown↔ProseMirror conversion is a vault import/export concern
 * the browser never runs, and its `unified`/`remark`/`yaml` toolchain (~160 kB) would otherwise ride the
 * initial bundle through the eagerly-registered plugin. The converter lives on
 * {@link RICH_CONTENT_DATA_TYPE_VAULT} (`rich-content-vault.ts`) — the same base, plus the converter —
 * which only the API bundles, so the toolchain code-splits out of the web entirely.
 */
export const RICH_CONTENT_DATA_TYPE = defineStructuredDataType({
  ...richContentBase,
  vault: { slot: 'body' },
});

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
