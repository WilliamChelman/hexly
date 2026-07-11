import { WorldVerb } from '@hexly/domain';
import { and, eq, sql, SQLWrapper } from 'drizzle-orm';
import { Db } from '../db/db';
import { entities, entityGrants, worldLinks, worldMembers, worlds } from '../db/schema';
import { isSuperadmin } from './owner-set';

/**
 * The World authorization rule (ADR-0024, ADR-0037, ADR-0039), in one home — the peer of
 * `entity-access.ts`. Unlike an Entity (read / substance / lifecycle verbs over a visibility
 * axis), a World has a single management axis: `manage`, held by a World Owner. Every reachable
 * World carries `read`. The SQL predicates below are the single source of truth; {@link
 * worldRightsOf} is the only JS projector off them, and {@link WorldAccess.managedBy} the only
 * set-form derivation. Superadmin is resolved once per context and closed over by every
 * predicate, so no caller re-threads the flag.
 */

/** A Superadmin reaches and manages every World (ADR-0037, #163): predicates short-circuit here. */
const MATCH_ALL = sql`1`;

/**
 * The predicate bodies below take the target World's id as a `worldRef` SQL expression rather than
 * hardcoding `worlds.id`. In a WHERE clause the two are equivalent, but drizzle strips table
 * qualifiers from column references embedded in a *top-level SELECT projection* — so a correlated
 * `entities.world_id = worlds.id` degrades to `world_id = id`, where the bare `id` binds to the
 * inner `entities.id`, silently breaking the entity-grant reachability branch. {@link
 * WorldAccess.decideMeta} therefore passes the id as a bound parameter (no column, nothing to
 * strip); the composable filters pass `worlds.id` for the correlated WHERE form. One body, two refs.
 */

/**
 * The World reachability rule (ADR-0024, ADR-0037): derived, not stored — the caller has a member
 * row OR any row in an Entity's ACE set inside the World (ownership *and* entity grants, one table
 * since owner folded into entity_grants, migration 0007). Covers the ex-member residue (a departed
 * member who kept Entities keeps minimal reachability) and a grantee navigating to what they were
 * given (#161). Unreachable is indistinguishable from nonexistent (ADR-0004).
 */
function reachableBy(userId: string, worldRef: SQLWrapper) {
  return sql`(EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${worldRef} AND ${worldMembers.userId} = ${userId})
    OR EXISTS (SELECT 1 FROM ${entities} JOIN ${entityGrants} ON ${entityGrants.entityId} = ${entities.id}
               WHERE ${entities.worldId} = ${worldRef} AND ${entityGrants.userId} = ${userId}))`;
}

/** The World management rule (ADR-0037): the caller holds the `owner` role. */
function ownedBy(userId: string, worldRef: SQLWrapper) {
  return sql`EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${worldRef} AND ${worldMembers.userId} = ${userId} AND ${worldMembers.role} = 'owner')`;
}

/** The Entity-creation rule (CONTEXT.md → Contributor): the caller holds `owner` *or* `contributor`. */
function creatableBy(userId: string, worldRef: SQLWrapper) {
  return sql`EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${worldRef} AND ${worldMembers.userId} = ${userId} AND ${worldMembers.role} IN ('owner', 'contributor'))`;
}

/**
 * The World reachability predicate — {@link reachableBy} correlated to `worlds.id`. Composes into
 * any WHERE over `worlds` (the one predicate both `list` and `get` share). Superadmin → match-all.
 */
export function worldReachFilter(userId: string, superadmin: boolean) {
  return superadmin ? MATCH_ALL : reachableBy(userId, worlds.id);
}

/**
 * The Entity-creation predicate (ADR-0024, CONTEXT.md → Contributor): the caller may author a new
 * Entity in a World when they hold the `owner` *or* `contributor` role — a Contributor's defining
 * capability. Broader than the management rule on purpose: creating an Entity is not a World
 * management power. A Superadmin short-circuits to match-all. Composes into a WHERE over `worlds`
 * so `resolveWorldId` can scope its default-World select without re-deriving the rule.
 */
export function canCreateEntityFilter(userId: string, superadmin: boolean) {
  return superadmin ? MATCH_ALL : creatableBy(userId, worlds.id);
}

/**
 * The World ownership predicate (ADR-0037): the caller holds the `owner` role. Composes into a
 * WHERE over `worlds`. Deliberately *no* Superadmin bypass — this expresses personal ownership
 * (the entity-create default's "my own oldest World"), not a repair capability, so it must never
 * widen to match-all and default an un-scoped create into an arbitrary World.
 */
export function worldOwnerFilter(userId: string) {
  return ownedBy(userId, worlds.id);
}

/**
 * Whether a World Public Link *token* currently reaches World `id` — the reachability seam the
 * nudge bus checks for a token principal (ADR-0044, #178), the World peer of `tokenReachesEntity`.
 * The token *is* the grant: a live `world_links` row pointing at the World grants anonymous
 * Dashboard reach, so rename/pin/metadata nudges flow and a revoked token (row gone) reaches
 * nothing (→ eviction). Blob-free and index-backed, so fine on the per-emit path.
 */
export function tokenReachesWorld(db: Db, token: string, id: string): boolean {
  const row = db
    .select({ id: worldLinks.id })
    .from(worldLinks)
    .where(and(eq(worldLinks.id, token), eq(worldLinks.worldId, id)))
    .get();
  return !!row;
}

/**
 * The caller's World Rights from a resolved management standing (ADR-0039) — the single place the
 * verb correspondence lives. Every reachable World carries `read` (a decision only exists when
 * reachable); an Owner (or Superadmin, folded into `isOwner`) also `manage`. Order is stable for
 * assertions.
 */
export function worldRightsOf(a: { isOwner: boolean }): WorldVerb[] {
  const rights: WorldVerb[] = ['read'];
  if (a.isOwner) rights.push('manage');
  return rights;
}

/** A per-request World access context (ADR-0024/0037/0039): the Superadmin bypass resolved once. */
export interface WorldAccess {
  /** Reachability predicate for a list/get WHERE over `worlds`. */
  reachFilter: ReturnType<typeof worldReachFilter>;
  /** Whether the caller is a Superadmin — manages every World (outside the model). */
  superadmin: boolean;
  /** Project a resolved management standing to the caller's verbs. */
  rightsOf: typeof worldRightsOf;
  /**
   * Whether the caller manages a World, from an *already-loaded* Owner set (the read paths fetch
   * it for the payload, so this is free — no extra query). The set form of {@link managesWorld}.
   */
  managedBy(owners: string[]): boolean;
  /** The World row if the caller can reach `id`, else undefined (unreachable ≡ missing). */
  decide(id: string): typeof worlds.$inferSelect | undefined;
  /**
   * Blob-free reachability + ownership in one query (no owner-set fetch), or undefined if no such
   * World — the owner/member/link management gates' single-row decision. Collapses the former
   * `decide()`-then-`isOwner()` two-query dance; feeds the shared {@link gate} directly.
   */
  decideMeta(id: string): { reachable: boolean; isOwner: boolean } | undefined;
}

/** Resolve the World access context for `userId` (Superadmin resolved once). */
export function worldAccess(db: Db, userId: string): WorldAccess {
  const superadmin = isSuperadmin(db, userId);
  const reachFilter = worldReachFilter(userId, superadmin);
  return {
    reachFilter,
    superadmin,
    rightsOf: worldRightsOf,
    managedBy(owners) {
      return superadmin || owners.includes(userId);
    },
    decide(id) {
      return db
        .select()
        .from(worlds)
        .where(and(eq(worlds.id, id), reachFilter))
        .get();
    },
    decideMeta(id) {
      // The predicates ride a top-level SELECT projection here, so the World id must be a bound
      // parameter, not a `worlds.id` correlation (see the projection-stripping note above).
      const worldRef = sql`${id}`;
      const row = db
        .select({
          reachable: superadmin ? MATCH_ALL : reachableBy(userId, worldRef),
          isOwner: superadmin ? MATCH_ALL : ownedBy(userId, worldRef),
        })
        .from(worlds)
        .where(eq(worlds.id, id))
        .get();
      return row ? { reachable: !!row.reachable, isOwner: !!row.isOwner } : undefined;
    },
  };
}
