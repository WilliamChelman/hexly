/**
 * `core.hex-grid` — the Hex Map's grid as a **Structured Data Type** (CONTEXT.md → Structured Data
 * Type, ADR-0050). `core.hexmap` declares it at the `grid` key, so a Hex Map's plane lives in the
 * one EntityDocument map.
 */

import {
  defineField,
  defineStructuredDataType,
  joinSearchText,
  type EntityEdge,
  type Field,
  type StructuredDataTypeId,
} from '@hexly/domain';
import { emptyHexMap, HexMap, hexMapSchema } from './hex-map';

/** The `namespace.id` kind naming the grid data-type — what marks the `grid` Field structured. */
export const CORE_HEX_GRID: StructuredDataTypeId = 'core.hex-grid';

/**
 * The grid data-type. A link can hang off a Hex, a Feature, or a Region; a map placement expresses
 * no relationship, so it carries no Link Descriptor.
 *
 * Its searchable text is what the user typed: Hex names, Region names, Labels (#205). A terrain or
 * feature id is a palette reference, not text — indexing it would match every grassland on "grass".
 */
export const HEX_GRID_DATA_TYPE = defineStructuredDataType({
  id: CORE_HEX_GRID,
  valueSchema: hexMapSchema,
  empty: emptyHexMap,
  harvestEdges: (grid: HexMap) => {
    const edges: EntityEdge[] = [];
    const link = (targetId: string | undefined) => {
      if (targetId) edges.push({ targetKind: 'entity', targetId, descriptor: null });
    };
    for (const hex of Object.values(grid.hexes)) {
      link(hex.entityId);
      link(hex.feature?.entityId);
    }
    for (const region of grid.regions) link(region.entityId);
    return edges;
  },
  extractText: (grid: HexMap) =>
    joinSearchText([
      ...Object.values(grid.hexes).map((hex) => hex.name),
      ...grid.regions.map((region) => region.name),
      ...grid.labels.map((label) => label.text),
    ]),
  // The grid projects to **frontmatter** (CONTEXT.md → Vault Projection, ADR-0051): it rides the YAML
  // as a nested Field value, which the vault layer serializes and re-reads generically — no `toMarkdown`
  // needed, and ADR-0050's map round-trip is preserved through the ordinary EntityDocument path.
  vault: { slot: 'frontmatter' },
});

/** The grid Field's namespaced identifier — its `id`, and (ADR-0056) the EntityDocument key it lenses. */
export const HEX_GRID_FIELD_ID = 'core.grid';

/**
 * The Field `core.hexmap` references, and the EntityDocument slice the map editor reads and writes — a
 * first-class **Plugin Field** ({@link defineField}, ADR-0054).
 *
 * The header's View toggle reads its label, a Structured Data Type's View being bound to the Field it
 * renders (ADR-0050); `labelKey` keeps that toggle translated.
 *
 * Its `id` (`core.grid`) *is* the EntityDocument slot it lenses — one namespaced identifier (ADR-0056).
 *
 * Not `required`: an absent grid opens as an empty plane and the first edit mints one. Never
 * facetable — a document has no discrete values to count (ADR-0050).
 */
export const HEX_GRID_FIELD: Field = defineField({
  id: HEX_GRID_FIELD_ID,
  // The untranslated fallback the API's available-types list reports; the web resolves `labelKey`.
  label: 'Map',
  labelKey: 'map.hexmap.view.map',
  dataType: { kind: CORE_HEX_GRID },
  required: false,
  facetable: false,
});
