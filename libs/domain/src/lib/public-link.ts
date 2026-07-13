/**
 * The unauthenticated Public Link surface: shareable, revocable links for people
 * without accounts. Two kinds, both backed by an unguessable token: a per-entity
 * Public Link (an anonymous Viewer grant that pierces `private`) and a World
 * Public Link (anonymous World Viewer over `shared` Entities).
 */

import { EntitySummary } from './entity';

/**
 * A minted Public Link — just its token (the client composes the shareable URL).
 * The read endpoint returns `null` when no link is active; one active link per target.
 */
export interface PublicLink {
  readonly token: string;
}

/**
 * What a World Public Link resolves to: the World's identity plus the summaries of its `shared`
 * Entities — and nothing else. A `private` Entity never appears here.
 */
export interface PublicWorldView {
  readonly worldId: string;
  readonly worldName: string;
  readonly entities: readonly EntitySummary[];
}
