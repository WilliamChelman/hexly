import { z } from 'zod';

/**
 * The live-follow nudge bus (ADR-0044). A single server→client SSE stream carries *nudges* —
 * "resource X is now at version N, refetch it" — never resource data. This module holds the
 * wire vocabulary shared by the API and the web client.
 *
 * This is the spine slice (#173): entity refs only, `{ id, version }` deltas, no per-recipient
 * payload shaping. The `unavailable`/eviction variant, World refs, and reconnect replay are
 * additive later slices (#171) — the array shape below is what makes them additive.
 */

/** A resource a connection is watching. A World is just another ref (ADR-0044) — one channel. */
export const interestRefSchema = z.object({
  kind: z.enum(['entity', 'world']),
  id: z.string(),
});
export type InterestRef = z.infer<typeof interestRefSchema>;

/**
 * The *whole* interest set a client declares via `PUT /events/:connectionId/interest`
 * (ADR-0044): idempotent, client-owned, no add/remove bookkeeping.
 */
export const interestSetSchema = z.object({
  refs: z.array(interestRefSchema),
});
export type InterestSet = z.infer<typeof interestSetSchema>;

/**
 * The handshake: the SSE stream's first event names this connection with an unguessable
 * `connectionId`, which the client then addresses its interest `PUT` to (ADR-0044).
 */
export interface ConnectionReady {
  connectionId: string;
}

/** One changed resource in a nudge. `version` dedupes self/cross-tab echo (ADR-0044). */
export interface EntityNudge {
  id: string;
  version: number;
}

/**
 * A nudge is a *delta* array holding only the resource(s) whose event fired (ADR-0044) — not a
 * full-set reconciliation. Reconnect → refetch-the-interest-set heals any missed event.
 */
export type NudgeDelta = EntityNudge[];
