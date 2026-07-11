/**
 * Harvest the Entity Links an Entity's document expresses, as a flat edge set
 * (ADR-0046). The write path derives this on every save and materializes it into
 * the derived edge index, so *References* / *Referenced by* and the World Graph
 * become indexed lookups instead of a walk over every Entity's document.
 */

import { assetHashFromUrl } from './asset';
import { visit } from './content/content-node';
import { descriptorSchema, EntityBody, EntityType, hasHexGrid } from './entity';

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
 * Every edge the body's Content and (for a Hex Map) map payload expresses, deduplicated on
 * `(targetKind, targetId, descriptor)`. Nothing records *where* a link was expressed, so a
 * prose mention and a map placement of the same target collapse to one edge, while two
 * descriptors to that target stay two.
 */
export function harvestEdges(body: EntityBody): EntityEdge[] {
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

  // Only a format this build knows is walkable, as in `extractText`. The map payload below is
  // format-independent, so a Hex Map's placements survive a Content format we cannot read.
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

  // A map placement expresses no relationship, so it carries no Link Descriptor. The presence of
  // the hex-grid payload — not a `type` field — is what marks a body as carrying map placements.
  if (hasHexGrid(body)) {
    for (const hex of Object.values(body.hexes)) {
      entityEdge(hex.entityId, null);
      entityEdge(hex.feature?.entityId, null);
    }
    for (const region of body.regions) entityEdge(region.entityId, null);
  }
  return [...edges.values()];
}
