/**
 * `core.datatype.rich-content` — prose as a **Structured Data Type** (CONTEXT.md → Structured Data Type,
 * ADR-0051). Every Type that means to carry prose declares the canonical {@link CONTENT_FIELD} at the
 * `content` key; a multi-type Entity resolves exactly one, since the effective set dedupes by key.
 *
 * The seam ADR-0019 named — the single place that knows the snapshot shape — has simply moved here: a
 * value's edges (its inline **Entity Links** and image Assets) and its searchable text come back
 * through the data-type the host registered, so the derive pass learns nothing about prose.
 */

import { z } from 'zod';
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
import { extractText } from './extract-text';

/** The `namespace.datatype.name` kind naming the prose data-type — what marks the `content` Field structured. */
export const CORE_RICH_CONTENT: StructuredDataTypeId = 'core.datatype.rich-content';

/** The format tag new saves write; a schema-affecting extension change is a bump + migration. */
export const CONTENT_FORMAT = 'tiptap-v3';

/**
 * Formats a reader loads losslessly. Each bump is additive, so every earlier
 * version's docs round-trip untouched with no transform. Saves always write
 * CONTENT_FORMAT.
 */
export const READABLE_CONTENT_FORMATS = ['tiptap-v1', 'tiptap-v2', 'tiptap-v3'] as const;

/**
 * The **Rich Content** value (CONTEXT.md → Rich Content, ADR-0019, ADR-0051): format-tagged
 * TipTap/ProseMirror JSON — what a Field of this data-type holds, at whatever key that Field lenses.
 * `snapshot` is `z.unknown()` so persistence stays format-agnostic — see ADR-0019.
 */
export const richContentSchema = z.object({
  format: z.enum(READABLE_CONTENT_FORMATS),
  snapshot: z.unknown(),
});

export type RichContent = z.infer<typeof richContentSchema>;

/** The one place a snapshot becomes Rich Content — keeps callers from hand-stamping the format tag. */
export function tiptapContent(snapshot: unknown): RichContent {
  return { format: CONTENT_FORMAT, snapshot };
}

/** A fresh, empty document — what `core.datatype.rich-content`'s `empty()` mints for a Type that declares prose. */
export function emptyRichContent(): RichContent {
  return tiptapContent({ type: 'doc', content: [] });
}

/**
 * The prose data-type's base capabilities, shared by both registrations. Its edges are the value's
 * inline **Entity Links** (each carrying its `::` **Link Descriptor**) and the Assets its images embed;
 * its searchable text is the prose {@link extractText} collects. A format this build cannot read harvests
 * nothing rather than throwing — the forward-only tolerance a document at rest needs. Kept plain so
 * `rich-content-vault.ts` reuses it without re-listing the schema and walks (ADR-0051).
 */
export const richContentBase = {
  id: CORE_RICH_CONTENT,
  valueSchema: richContentSchema,
  empty: emptyRichContent,
  harvestEdges: (content: RichContent): EntityEdge[] => {
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
  extractText: (content: RichContent) => extractText(content),
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

/** The prose Field's namespaced identifier — its `id`, and (ADR-0056) the EntityDocument key it lenses. */
export const CONTENT_FIELD_ID = 'core.field.content';

/**
 * The canonical prose Field every Type that carries prose references by id (ADR-0051, ADR-0054):
 * `core.type.note`, `core.type.hex-map` beside its grid, `dnd.type.monster` beside its stats. The effective-set
 * resolver dedupes by `id`, so a multi-type Entity resolves exactly one.
 *
 * Its `id` (`core.field.content`) *is* the EntityDocument slot it lenses — one namespaced identifier (ADR-0056).
 *
 * The header's View toggle reads its `labelKey` (a Structured Data Type's View being bound to the Field it
 * renders); the toggle moving onto the Field is the next ticket. Not `required`: an absent value opens
 * as an empty document and the first edit mints one. Never facetable — a document has no discrete
 * values to count.
 */
export const CONTENT_FIELD: Field = defineField({
  id: CONTENT_FIELD_ID,
  // The untranslated fallback; the web resolves `labelKey` through transloco.
  label: 'Content',
  labelKey: 'editor.view.content',
  dataType: { kind: CORE_RICH_CONTENT },
  required: false,
  facetable: false,
});
