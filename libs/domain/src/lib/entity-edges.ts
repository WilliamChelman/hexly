/**
 * The Entity-Link edge shapes (ADR-0046) — the flat edge set an Entity's document expresses, and the
 * per-viewer References an edge resolves to. The derivation itself lives in {@link deriveDocumentState}.
 */

import { EntityType } from './entity';

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
  /**
   * The served Thumbnail URL (ADR-0066), present only when one resolves — the linked Entity's Thumbnail
   * Field designation beating its own image bytes, exactly as a list resolves it. Absent → the surface
   * falls back to the primary type's glyph. Always safe as an `<img src>`.
   */
  readonly thumbnailUrl?: string;
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
