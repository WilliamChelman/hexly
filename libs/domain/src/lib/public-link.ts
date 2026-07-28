/**
 * The unauthenticated Public Link surface: shareable, revocable links for people
 * without accounts. Two kinds, both backed by an unguessable token: a per-entity
 * Public Link (an anonymous Viewer grant that pierces `private`) and a World
 * Public Link (anonymous World Viewer over `shared` Entities).
 */

import { EntitySummary } from './entity';
import { WorldTheme } from './world-theme';

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
  /**
   * The World Theme (ADR-0076), absent when the World carries none. Served here because the visitor
   * has no account to resolve one through, so holding the link is enough to read it.
   */
  readonly theme?: WorldTheme;
}
