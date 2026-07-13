import { z } from 'zod';

/**
 * The live-follow nudge bus. A single server→client SSE stream carries *nudges* —
 * "resource X is now at version N, refetch it" — never resource data.
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
 * One changed Entity. `seq` is the sole freshness key (ADR-0045): a monotonic counter the server
 * bumps on *every* committed change, whatever its kind — substance, exposure, sharing, lifecycle.
 * A holder refetches exactly when a nudge's `seq` exceeds the one it holds, which dedupes
 * self/cross-tab echo. Neither `version` nor `updatedAt` rides the wire.
 */
export interface EntityNudge {
  id: string;
  seq: number;
}

/**
 * A changed World — keyed like {@link EntityNudge}. Rename, pin reorder, and membership changes
 * all flow here.
 */
export interface WorldNudge {
  id: string;
  seq: number;
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

/** One per-recipient entry: still-readable → `seq`, access ended → `unavailable`. */
export type NudgeEntry = EntityNudge | WorldNudge | UnavailableNudge;

/**
 * A client-minted refetch pulse — **never a server frame**, so it is not part of {@link NudgeEntry}
 * (the wire union parsed from SSE JSON). On reconnect the client can't know what changed during the
 * gap (there is no server-side event log or `Last-Event-ID` replay), so its bus pulses each watched
 * ref `stale` and the follower refetches unconditionally. Version-free: it carries no claim about
 * the resource, only "your held state may be stale."
 */
export interface StaleNudge {
  id: string;
  stale: true;
}

/** What a live-follow subscriber sees: a server nudge, or the client's local `stale` reconnect pulse. */
export type FollowSignal = NudgeEntry | StaleNudge;

/**
 * A nudge is a *delta* array holding only the resource(s) whose event fired — not a
 * full-set reconciliation. Reconnect → refetch-the-interest-set heals any missed event.
 */
export type NudgeDelta = NudgeEntry[];
