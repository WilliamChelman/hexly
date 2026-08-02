/**
 * `core.datatype.board-surface` — the Board's surface as a **Structured Data Type** (CONTEXT.md → Board Surface,
 * ADR-0050/0051). `core.type.board` declares it at the `core.field.surface` key, so a Board's plane lives in the one
 * EntityDocument map. Follows `core.datatype.hex-grid` exactly.
 */

import {
  assetEdgeFromUrl,
  defineField,
  defineStructuredDataType,
  joinSearchText,
  type EntityEdge,
  type Field,
  type StructuredDataTypeId,
} from '@hexly/domain';
import { extractText, visit } from '@hexly/plugin-content';
import { BoardSurface, boardSurfaceSchema, emptyBoardSurface } from './board-surface';

/** The `namespace.id` kind naming the surface data-type — what marks the `core.field.surface` Field structured. */
export const CORE_BOARD_SURFACE: StructuredDataTypeId = 'core.datatype.board-surface';

/**
 * The surface data-type. Its edges are every **Embed**'s target, every inline **Entity Link** inside a
 * **Text Block**, and the **Asset** an **Image** element displays (its capability `assetUrl` resolved
 * URL → hash into an asset edge, ADR-0065, so an Asset placed on a Board counts as usage/inbound-link like
 * one embedded in prose) — an Embed, a surface link, and an Image placement each express a placement, not a
 * characterised relationship, so (like a Hex Map placement) they carry no **Link Descriptor**. Its
 * searchable text is the Text Block prose the user typed. No facet dimensions — a Board harvests no facets
 * (user story 52).
 */
export const BOARD_SURFACE_DATA_TYPE = defineStructuredDataType({
  id: CORE_BOARD_SURFACE,
  valueSchema: boardSurfaceSchema,
  empty: emptyBoardSurface,
  harvestEdges: (surface: BoardSurface) => {
    const edges: EntityEdge[] = [];
    // A Board **Embed** and a Text Block's inline Entity Link are always semantic (ADR-0069): embedding is
    // a curatorial act, a written link is authored meaning — both count as relations even against an Asset.
    const link = (targetId: string) => edges.push({ targetKind: 'entity', targetId, descriptor: null, decor: false });
    for (const element of surface.elements) {
      if (element.kind === 'embed') {
        link(element.targetEntityId);
      } else if (element.kind === 'image') {
        // An Image element references its Asset by capability URL — the same edge Content prose harvests,
        // decor by construction and scoped to the Container the URL names (ADR-0065/0069/0080). A non-Asset
        // `src` (external URL, not-yet-rewritten vault path) resolves to no Asset and no edge.
        const edge = assetEdgeFromUrl(element.assetUrl);
        if (edge) edges.push(edge);
      } else if (element.kind === 'text' && element.content.format.startsWith('tiptap-')) {
        visit(element.content.snapshot, (node) => {
          if (node.type !== 'entityLink') return;
          const entityId = node.attrs?.['entityId'];
          if (typeof entityId === 'string') link(entityId);
        });
      }
    }
    return edges;
  },
  extractText: (surface: BoardSurface) =>
    joinSearchText(
      surface.elements.filter((element) => element.kind === 'text').map((element) => extractText(element.content)),
    ),
  // The surface projects to **frontmatter** (CONTEXT.md → Vault Projection, ADR-0051): the whole element
  // model rides the YAML as a nested Field value the vault layer serializes generically — no `toMarkdown`.
  vault: { slot: 'frontmatter' },
});

/** The surface Field's namespaced identifier — its `id`, and (ADR-0056) the EntityDocument key it lenses. */
export const SURFACE_FIELD_ID = 'core.field.surface';

/**
 * The Field `core.type.board` references, and the EntityDocument slice the board editor reads and writes — a
 * first-class **Plugin Field** ({@link defineField}, ADR-0054), the mirror of the Hex Map's grid Field.
 *
 * Its `id` (`core.field.surface`) *is* the EntityDocument slot it lenses — one namespaced identifier (ADR-0056).
 *
 * Not `required`: an absent surface opens as an empty plane and the first edit mints one. Never facetable
 * — a document has no discrete values to count (ADR-0050).
 */
export const SURFACE_FIELD: Field = defineField({
  id: SURFACE_FIELD_ID,
  // The untranslated fallback the API's available-types list reports; the web resolves `labelKey`.
  label: 'Board',
  labelKey: 'board.view.surface',
  dataType: { kind: CORE_BOARD_SURFACE },
  required: false,
  facetable: false,
});
