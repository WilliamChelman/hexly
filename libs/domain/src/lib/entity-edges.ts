/**
 * Harvest the Entity Links an Entity's document expresses, as a flat edge set (ADR-0046). The write
 * path derives this on every save and materializes it into the derived edge index.
 */

import { EntityType } from './entity';
import {
  entityLinkFieldValues,
  FieldSchema,
  EntityDocument,
  readField,
  resolvedStructuredDataTypeFields,
} from './field';
import type { StructuredDataTypeSet } from './structured-data-type';

/** What an edge points at: another Entity, or an Asset (CONTEXT.md → Asset). */
export type EdgeTargetKind = 'entity' | 'asset';

/**
 * One link the source Entity's document expresses. An edge only names its target; the source is the
 * caller's to supply. `descriptor` is the Link Descriptor, set on a document's inline links alone.
 */
export interface EntityEdge {
  readonly targetKind: EdgeTargetKind;
  /** An `entityId`, or an Asset `hash`. Dangling-allowed — never a referential constraint. */
  readonly targetId: string;
  readonly descriptor: string | null;
}

/**
 * An Entity at one end of a link, as a link list renders it: enough to name it and navigate to it.
 * Names are never stored on an edge — both directions resolve the current name from `entities` live.
 */
export interface LinkedEntity {
  readonly id: string;
  readonly name: string;
  /** The ordered Entity Type set; `types[0]` is primary and drives the icon/colour a surface draws. */
  readonly types: readonly EntityType[];
}

/**
 * One of this Entity's own links (*References*). `target` is `null` when it is deleted or the
 * viewer cannot read it — indistinguishable, and both render as the existing non-navigable
 * dangling label. Asset edges are stored but have no surface, so they never appear here.
 */
export interface OutboundReference {
  readonly targetId: string;
  readonly descriptor: string | null;
  readonly target: LinkedEntity | null;
}

/**
 * One link *to* this Entity (*Referenced by*). `source` is never null: the list is filtered by
 * the viewer's access to the source, so an edge the viewer may not read is absent, not dangling.
 */
export interface InboundReference {
  readonly descriptor: string | null;
  readonly source: LinkedEntity;
}

/** `GET /entities/:id/references`: both directions of one Entity's links, resolved per viewer. */
export interface EntityReferences {
  readonly references: readonly OutboundReference[];
  readonly referencedBy: readonly InboundReference[];
}

/**
 * Every edge the doc expresses, deduplicated on `(targetKind, targetId, descriptor)`: resolved
 * against the Entity's `fields`, each typed **Entity-Link Field** value (#190) and each **Structured
 * Data Type** Field's own harvest (a map's placements, a document's inline links and image Assets, ADR-0050,
 * ADR-0051). Nothing records *where* a link was expressed, so a prose mention, a map placement, and a
 * Field link to the same target collapse to one edge, while two descriptors to that target stay two.
 *
 * `doc` is the EntityDocument map, `fields` its resolved Field schema set ({@link resolveFields}) and
 * `dataTypes` the host-composed **Structured Data Type** set (ADR-0050). The domain names no extractor
 * of its own: prose reaches this loop as the `core.rich-content` data-type, exactly as a grid does.
 */
export function harvestEdges(
  doc: EntityDocument,
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): EntityEdge[] {
  const edges = new Map<string, EntityEdge>();
  const add = (edge: EntityEdge) => {
    // `\0` cannot occur in an id or a descriptor, so the key is unambiguous. The descriptor folds
    // into the key but not into the row: `"Spouse"` and `"spouse"` name one relationship, and the
    // first spelling authored is the one the edge — and so the References panel — carries.
    const key = `${edge.targetKind}\0${edge.targetId}\0${edge.descriptor?.toLowerCase() ?? ''}`;
    if (!edges.has(key)) edges.set(key, edge);
  };
  const entityEdge = (targetId: string | undefined, descriptor: string | null) => {
    if (targetId) add({ targetKind: 'entity', targetId, descriptor });
  };

  // A typed Entity-Link Field value is a descriptor-less edge to its target (#190).
  for (const { value } of entityLinkFieldValues(fields, doc)) entityEdge(value.entityId, null);

  // A Field of a Structured Data Type harvests its own (ADR-0050): the value goes to the data-type the
  // host registered, and the edges come back — the domain never learns what is inside it. Prose's inline
  // links and image Assets arrive this way now too, through `core.rich-content` (ADR-0051).
  for (const { field, dataType } of resolvedStructuredDataTypeFields(fields, dataTypes))
    for (const edge of dataType.harvestEdges?.(readField(doc, field)) ?? []) add(edge);

  return [...edges.values()];
}
