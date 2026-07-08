import { z } from 'zod';

/**
 * The live-follow nudge bus. A single server→client SSE stream carries *nudges* —
 * "resource X is now at version N, refetch it" — never resource data. This module
 * holds the wire vocabulary shared by the API and the web client.
 */

/** A resource a connection is watching. A World is just another ref — one channel. */
export const interestRefSchema = z.object({
  kind: z.enum(['entity', 'world']),
  id: z.string(),
});
export type InterestRef = z.infer<typeof interestRefSchema>;

/**
 * The *whole* interest set a client declares via `PUT /events/:connectionId/interest`:
 * idempotent, client-owned, no add/remove bookkeeping.
 */
export const interestSetSchema = z.object({
  refs: z.array(interestRefSchema),
});
export type InterestSet = z.infer<typeof interestSetSchema>;

/**
 * The handshake: the SSE stream's first event names this connection with an unguessable
 * `connectionId`, which the client then addresses its interest `PUT` to.
 */
export interface ConnectionReady {
  connectionId: string;
}

/**
 * One changed resource in a nudge. `version` + `updatedAt` dedupe self/cross-tab echo:
 * a holder refetches only on something newer than it has. A metadata patch (rename,
 * visibility) touches `updatedAt` *without* bumping `version` — carrying both is what
 * lets a follower see a same-version rename as new.
 */
export interface EntityNudge {
  id: string;
  version: number;
  updatedAt: number;
}

/**
 * The eviction entry: the recipient's own access to a followed resource has ended.
 * Opaque and version-free — unauthorized, deleted, and never-existed are byte-identical,
 * so the status can't leak "it still exists, you just can't see it."
 */
export interface UnavailableNudge {
  id: string;
  unavailable: true;
}

/** One per-recipient entry: still-readable → version, access ended → unavailable. */
export type NudgeEntry = EntityNudge | UnavailableNudge;

/**
 * A nudge is a *delta* array holding only the resource(s) whose event fired — not a
 * full-set reconciliation. Reconnect → refetch-the-interest-set heals any missed event.
 */
export type NudgeDelta = NudgeEntry[];
