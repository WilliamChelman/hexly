/**
 * The unauthenticated Public Link surface (ADR-0037): shareable links for people
 * without accounts — minimal and revocable (ADR-0004). Two kinds, both backed by an
 * unguessable token: a per-entity Public Link (an anonymous Viewer grant that pierces
 * `private`) and a World Public Link (anonymous World Viewer over `shared` Entities).
 * The single Zod/type source of truth (ADR-0001) for their REST payloads.
 */

import { EntitySummary } from './entity';

/**
 * A minted Public Link — just its token (the client composes the shareable URL). Returned
 * by the mint (POST) and read (GET) endpoints; the read endpoint returns `null` when no
 * link is active. One active link per target, so this is the whole surface (ADR-0037).
 */
export interface PublicLink {
  readonly token: string;
}

/**
 * What a World Public Link resolves to (ADR-0037): the World's identity plus the summaries
 * of its `shared` Entities — and nothing else. The Home Entity (always `shared`) appears in
 * that listing as the landing page; a reader opens any listed Entity's full body through the
 * token-scoped per-entity read route. `private` Entities never appear here — the token can't reach them.
 */
export interface PublicWorldView {
  readonly worldId: string;
  readonly worldName: string;
  readonly entities: readonly EntitySummary[];
}
