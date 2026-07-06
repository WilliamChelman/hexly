import { and, eq, sql } from 'drizzle-orm';
import { Db } from '../db/db';
import { entities, entityGrants, worldMembers, worlds } from '../db/schema';
import { isSuperadmin } from './owner-set';

/**
 * World reachability (ADR-0024, ADR-0037), in one home. Unlike an Entity (which layers read /
 * write / substance verbs over a visibility axis), a World has a single derived axis —
 * reachability — so its access context is just that predicate plus a single-row resolver.
 */

/** A Superadmin reaches every World (ADR-0037, #163): the reachability predicate short-circuits here. */
const MATCH_ALL = sql`1`;

/**
 * The World reachability predicate (ADR-0024, ADR-0037): derived, not stored — the caller has a
 * member row OR any row in an Entity's ACE set inside the World (ownership *and* entity grants,
 * one table since owner folded into entity_grants, migration 0007). Covers the ex-member residue
 * (a departed member who kept Entities keeps minimal reachability) and a grantee navigating to
 * what they were given (#161). Composes into any WHERE over `worlds` — the one predicate both
 * `list` and `get` share. A Superadmin short-circuits to match-all. Unreachable is
 * indistinguishable from nonexistent (ADR-0004).
 */
export function worldReachFilter(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${worlds.id} AND ${worldMembers.userId} = ${userId})
    OR EXISTS (SELECT 1 FROM ${entities} JOIN ${entityGrants} ON ${entityGrants.entityId} = ${entities.id}
               WHERE ${entities.worldId} = ${worlds.id} AND ${entityGrants.userId} = ${userId}))`;
}

/** A per-request World access context (ADR-0024/0037): the Superadmin bypass resolved once. */
export interface WorldAccess {
  /** Reachability predicate for a list/get WHERE over `worlds`. */
  reachFilter: ReturnType<typeof worldReachFilter>;
  /** Whether the caller is a Superadmin — for the `worldRights` projection (manages every World). */
  superadmin: boolean;
  /** The World row if the caller can reach `id`, else undefined (unreachable ≡ missing). */
  decide(id: string): typeof worlds.$inferSelect | undefined;
}

/** Resolve the World access context for `userId` (Superadmin resolved once). */
export function worldAccess(db: Db, userId: string): WorldAccess {
  const superadmin = isSuperadmin(db, userId);
  const reachFilter = worldReachFilter(userId, superadmin);
  return {
    reachFilter,
    superadmin,
    decide(id) {
      return db.select().from(worlds).where(and(eq(worlds.id, id), reachFilter)).get();
    },
  };
}
