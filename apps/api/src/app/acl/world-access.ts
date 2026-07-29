import { WorldVerb } from '@hexly/domain';
import { and, eq, getTableColumns, inArray, sql, SQLWrapper } from 'drizzle-orm';
import { Db } from '../db/db';
import { containers, entities, entityGrants, WorldRow, worldLinks, worldMembers, worlds } from '../db/schema';
import { isSuperadmin } from './owner-set';

/** A Superadmin reaches and manages every World (ADR-0037, #163): predicates short-circuit here. */
const MATCH_ALL = sql`1`;

/**
 * The predicate bodies below take the target World's id as a `worldRef` SQL expression rather than
 * hardcoding `worlds.id`. In a WHERE clause the two are equivalent, but drizzle strips table
 * qualifiers from column references embedded in a *top-level SELECT projection* — so a correlated
 * `entities.container_id = worlds.id` degrades to `container_id = id`, where the bare `id` binds to the
 * inner `entities.id`, silently breaking the entity-grant reachability branch. {@link
 * WorldAccess.decideMeta} therefore passes the id as a bound parameter (no column, nothing to
 * strip); the composable filters pass `worlds.id` for the correlated WHERE form. One body, two refs.
 */

/**
 * The World reachability rule (ADR-0024, ADR-0037): derived, not stored — the caller has a member
 * row OR any row in an Entity's ACE set inside the World. So a departed member who kept Entities,
 * and a grantee navigating to what they were given, both keep minimal reachability (#161).
 * Unreachable is indistinguishable from nonexistent (ADR-0004).
 */
function reachableBy(userId: string, worldRef: SQLWrapper) {
  return sql`(EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${worldRef} AND ${worldMembers.userId} = ${userId})
    OR EXISTS (SELECT 1 FROM ${entities} JOIN ${entityGrants} ON ${entityGrants.entityId} = ${entities.id}
               WHERE ${entities.containerId} = ${worldRef} AND ${entityGrants.userId} = ${userId}))`;
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
 * The World reachability predicate — {@link reachableBy} correlated to `worlds.id`, for a WHERE
 * over `worlds`. Superadmin → match-all.
 */
export function worldReachFilter(userId: string, superadmin: boolean) {
  return superadmin ? MATCH_ALL : reachableBy(userId, worlds.id);
}

/**
 * The Entity-creation predicate (ADR-0024, CONTEXT.md → Contributor): the caller may author a new
 * Entity in a World when they hold the `owner` *or* `contributor` role — broader than the
 * management rule, since creating an Entity is not a World management power. Superadmin →
 * match-all. Composes into a WHERE over `worlds`.
 */
export function canCreateEntityFilter(userId: string, superadmin: boolean) {
  return superadmin ? MATCH_ALL : creatableBy(userId, worlds.id);
}

/**
 * The World ownership predicate (ADR-0037): the caller holds the `owner` role, for a WHERE over
 * `worlds`. No Superadmin bypass — this expresses personal ownership (the entity-create default's
 * "my own oldest World"), and must never widen to match-all and default an un-scoped create into
 * an arbitrary World.
 */
export function worldOwnerFilter(userId: string) {
  return ownedBy(userId, worlds.id);
}

/**
 * The one home of the whole-World read: the Container's identity columns beside the satellite's
 * own. Driven off `worlds`, never `containers` — the satellite *is* the "this is a World"
 * discriminator, so no `kind` exclusion is needed here or anywhere else (ADR-0078).
 *
 * The satellite's `kind` deliberately shadows the Container's in the projection: for a World row the
 * Container's is `'world'` by construction, and the label worth carrying is campaign-or-Shelf
 * (ADR-0080).
 */
function selectWorld(db: Db) {
  return db
    .select({
      ...getTableColumns(containers),
      kind: worlds.kind,
      pinnedEntityIds: worlds.pinnedEntityIds,
      theme: worlds.theme,
    })
    .from(worlds)
    .innerJoin(containers, eq(containers.id, worlds.id));
}

/**
 * The whole World at `id`, with no access check — for a caller that has already resolved one
 * (an Owner-gated update). {@link WorldAccess.decide} is the reachability-filtered form.
 */
export function loadWorld(db: Db, id: string): WorldRow | undefined {
  return selectWorld(db).where(eq(worlds.id, id)).get();
}

/**
 * Whether a World Public Link *token* currently reaches World `id` — the reachability seam the
 * nudge bus checks for a token principal (ADR-0044, #178). The token *is* the grant: a live
 * `world_links` row pointing at the World grants anonymous Dashboard reach; a revoked token (row
 * gone) reaches nothing (→ eviction).
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
 * The caller's World Rights from a resolved standing (ADR-0039). Every reachable World carries
 * `read` (a decision only exists when reachable); an Owner or Contributor also `create-entity` —
 * the same `owner ∨ contributor` rule {@link canCreateEntityFilter} enforces on the write, so the
 * client hides the Create rows it would refuse rather than showing them and failing (ADR-0073); an
 * Owner (or Superadmin, folded into `isOwner`) also `manage`. Order is stable.
 */
export function worldRightsOf(a: { isOwner: boolean; canContribute: boolean }): WorldVerb[] {
  const rights: WorldVerb[] = ['read'];
  if (a.canContribute) rights.push('create-entity');
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
  /** Whether the caller manages a World, from an *already-loaded* Owner set (no extra query). */
  managedBy(owners: string[]): boolean;
  /**
   * Which of `ids` the caller may create Entities in — the page form of {@link decideMeta}'s
   * `canContribute`, in one caller-scoped read so a World list never fans out per World (ADR-0039).
   */
  contributingIn(ids: readonly string[]): Set<string>;
  /** The whole World if the caller can reach `id`, else undefined (unreachable ≡ missing). */
  decide(id: string): WorldRow | undefined;
  /**
   * Blob-free reachability + ownership + contribution in one query (no owner-set fetch), or
   * undefined if no such World. `canContribute` is the Entity-creation standing (owner ∨
   * contributor ∨ Superadmin) — the gate an Asset upload rides (#269, ADR-0034).
   */
  decideMeta(id: string): { reachable: boolean; isOwner: boolean; canContribute: boolean } | undefined;
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
    contributingIn(ids) {
      if (ids.length === 0) return new Set();
      // The Entity-creation predicate itself, batched over the page — one rule, not a second copy of
      // it; the Superadmin bypass rides along inside the filter.
      const rows = db
        .select({ id: worlds.id })
        .from(worlds)
        .where(and(inArray(worlds.id, [...ids]), canCreateEntityFilter(userId, superadmin)))
        .all();
      return new Set(rows.map((r) => r.id));
    },
    decide(id) {
      return selectWorld(db)
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
          canContribute: superadmin ? MATCH_ALL : creatableBy(userId, worldRef),
        })
        .from(worlds)
        .where(eq(worlds.id, id))
        .get();
      return row
        ? { reachable: !!row.reachable, isOwner: !!row.isOwner, canContribute: !!row.canContribute }
        : undefined;
    },
  };
}
