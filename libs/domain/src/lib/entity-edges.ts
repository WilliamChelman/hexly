/**
 * Harvest the Entity Links an Entity's document expresses, as a flat edge set
 * (ADR-0046). The write path derives this on every save and materializes it into
 * the derived edge index, so *References* / *Referenced by* and the World Graph
 * become indexed lookups instead of a walk over every Entity's document.
 */

import { assetHashFromUrl } from './asset';
import { visit } from './content/content-node';
import { descriptorSchema, EntityBody, EntityType } from './entity';
import { entityLinkFieldValues, FieldSchema, readField, resolvedStructuredFields } from './field';
import type { StructuredDataTypeSet } from './structured-data-type';

/** What an edge points at: another Entity, or an Asset (CONTEXT.md → Asset). */
export type EdgeTargetKind = 'entity' | 'asset';

/**
 * One link the source Entity's document expresses. The source is the Entity the
 * document belongs to, so it is the caller's to supply — an edge only names its
 * target. `descriptor` is the Link Descriptor, set on Content links alone.
 */
export interface EntityEdge {
  readonly targetKind: EdgeTargetKind;
  /** An `entityId`, or an Asset `hash`. Dangling-allowed — never a referential constraint. */
  readonly targetId: string;
  readonly descriptor: string | null;
}

/**
 * An Entity at one end of a link, as a link list renders it: enough to name it and navigate to
 * it. Names are never stored on an edge — a rename needs no edge rewrite, so both directions
 * resolve the current name from `entities` live (ADR-0046).
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
 * Every edge the body expresses, deduplicated on `(targetKind, targetId, descriptor)`: the
 * Content's inline links, and — resolved against the Entity's `fields` — each typed **Entity-Link
 * Field** value (#190) and each **Structured Field**'s own harvest (a map's placements, ADR-0050).
 * Nothing records *where* a link was expressed, so a prose mention, a map placement, and a Field link
 * to the same target collapse to one edge, while two descriptors to that target stay two.
 *
 * `fields` is the Entity's resolved Field schema set ({@link resolveFields}) and `dataTypes` the
 * host-composed **Structured Field** set (ADR-0050), from which a structured value harvests its own
 * edges. A caller with no type context passes `[]` and the empty set, and harvests the Content's
 * edges alone — every Field edge, a structured value's included, needs the type set.
 */
export function harvestEdges(
  body: EntityBody,
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

  // Only a format this build knows is walkable, as in `extractText`. The Field edges below are
  // format-independent, so a map's placements survive a Content format we cannot read.
  if (body.content.format.startsWith('tiptap-')) {
    visit(body.content.snapshot, (node) => {
      if (node.type === 'entityLink') {
        const entityId = node.attrs?.['entityId'];
        if (typeof entityId !== 'string') return;
        // A blank or absent descriptor is no descriptor — the same edge as an unadorned link.
        entityEdge(entityId, descriptorSchema.safeParse(node.attrs?.['descriptor']).data ?? null);
        return;
      }
      if (node.type === 'image') {
        const src = node.attrs?.['src'];
        const hash = typeof src === 'string' ? assetHashFromUrl(src) : null;
        if (hash) add({ targetKind: 'asset', targetId: hash, descriptor: null });
      }
    });
  }

  // A typed Entity-Link Field value is a descriptor-less edge to its target (#190), read off the
  // Metadata map rather than the Content snapshot — so it is format-independent, unlike the above.
  for (const { value } of entityLinkFieldValues(fields, body.metadata)) entityEdge(value.entityId, null);

  // A Structured Field harvests its own (ADR-0050): the value goes to the data-type the host
  // registered, and the edges come back — the domain never learns what is inside it. This is how the
  // Map plugin's placements reach the index: through the same path any plugin's would take, with no
  // map-shaped branch left here.
  for (const { field, dataType } of resolvedStructuredFields(fields, dataTypes))
    for (const edge of dataType.harvestEdges?.(readField(body.metadata, field)) ?? []) add(edge);

  return [...edges.values()];
}
