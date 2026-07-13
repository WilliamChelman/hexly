/**
 * `core.hex-grid` — the Hex Map's grid as a **Structured Field** data-type (CONTEXT.md → Structured
 * Field, ADR-0050). `core.hexmap` declares it at the `grid` key, so a Hex Map's plane lives in the
 * one Metadata map.
 */

import {
  defineStructuredDataType,
  joinSearchText,
  type EntityEdge,
  type FieldSchema,
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
});

/**
 * The Field `core.hexmap` declares, and the Metadata slice the map editor reads and writes.
 *
 * The header's View toggle reads its label, a Structured Field's View being bound to the Field it
 * renders (ADR-0050); `labelKey` keeps that toggle translated. A World Owner's own grid Field has no
 * key, and shows its authored name verbatim.
 *
 * Not `required`: an absent grid opens as an empty plane and the first edit mints one. Never
 * facetable — a document has no discrete values to count (ADR-0050).
 */
export const HEX_GRID_FIELD: FieldSchema = Object.freeze({
  key: 'grid',
  // The untranslated fallback the API's available-types list reports; the web resolves `labelKey`.
  label: 'Map',
  labelKey: 'map.hexmap.view.map',
  dataType: { kind: CORE_HEX_GRID },
  required: false,
  facetable: false,
});
