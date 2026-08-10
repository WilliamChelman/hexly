import { EntityVerb, GrantRole } from '@hexly/domain';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { Db } from '../db/db';
import { entities, entityGrants, worldMembers, worlds } from '../db/schema';
import { inACompendium } from '../worlds/compendiums';
import { mountedIntoReachOf } from './mount-reach';
import { isSuperadmin } from './owner-set';

/** The Superadmin bypass: every predicate short-circuits to match-all. */
const MATCH_ALL = sql`1`;

/**
 * The stored `entity_grants.role` vocabulary: the API-facing {@link GrantRole} plus
 * `owner`. Owner is a *stored* role only — it never appears in a grant request body.
 */
type StoredEntityRole = 'owner' | GrantRole;

/** The caller holds an entity ACE row whose role is one of `roles`. */
function hasGrant(userId: string, roles: readonly StoredEntityRole[]) {
  const list = sql.join(
    roles.map((r) => sql`${r}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM ${entityGrants} WHERE ${entityGrants.entityId} = ${entities.id} AND ${entityGrants.userId} = ${userId} AND ${entityGrants.role} IN (${list}))`;
}

/** The caller is one of the Entity's Owners (an `owner`-role grant row). */
export function ownsEntity(userId: string, superadmin: boolean) {
  return superadmin ? MATCH_ALL : hasGrant(userId, ['owner']);
}

/** The caller has any membership row in the Entity's World (owner/contributor/viewer). */
function isWorldMember(userId: string) {
  return sql`EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${entities.containerId} AND ${worldMembers.userId} = ${userId})`;
}

/** The caller is a World Owner (role 'owner') of the Entity's World. */
function isWorldOwner(userId: string) {
  return sql`EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${entities.containerId} AND ${worldMembers.userId} = ${userId} AND ${worldMembers.role} = 'owner')`;
}

/** The Entity's World is **Open** (ADR-0084) — the `worlds.open` flag on the Entity's Container. */
function inAnOpenWorld() {
  return sql`EXISTS (SELECT 1 FROM ${worlds} WHERE ${worlds.id} = ${entities.containerId} AND ${worlds.open})`;
}

/**
 * The **listing** predicate: `owner ∨ grant(editor|viewer) ∨ (member ∧ shared) ∨ compendium-entry ∨
 * (mounted ∧ shared)`. What a browse/search/Palette enumerates; an unreadable Entity is indistinguishable
 * from a missing one, so `private` never leaks existence, and an entity-level grant pierces `private`.
 *
 * `open` is deliberately absent (ADR-0084): listing stays World-and-Mounts-scoped, so an `open` Entity is
 * reachable Instance-wide by id (see {@link canReadEntity}) yet lists nowhere for a non-member — the
 * unlisted property the retired Public Link had.
 *
 * The compendium disjunct is the Compendium's own Instance-wide reachability (ADR-0078/0079): no members
 * or roles to resolve, so being signed in is the standing. The last is the Mount cascade (ADR-0080), on
 * the same `shared` line — a Mount republishes only what the mounted Container publishes.
 */
function canListEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(${hasGrant(userId, ['owner', 'editor', 'viewer'])} OR (${entities.visibility} = 'shared' AND ${isWorldMember(userId)}) OR ${inACompendium()}
    OR (${entities.visibility} = 'shared' AND ${mountedIntoReachOf(userId, entities.containerId)}))`;
}

/**
 * The **reachability** predicate: {@link canListEntity} `∨ open ∨ (shared ∧ Open-World)`. Whether the
 * caller can read *a specific Entity it already names* — get-by-id, References/link-index resolution
 * (ADR-0046/0072), a live follow (ADR-0044). ADR-0084's two membership-independent disjuncts: an `open`
 * Entity reads to any signed-in caller, and a `shared` Entity in an Open World reads to the same audience
 * (the successor to the World Public Link's `shared`-only reach). `private` stays unreachable — the second
 * disjunct is `shared`-only, so Instance membership never pierces it.
 *
 * These disjuncts ride only surfaces that resolve a *named* Entity, never the enumeration WHERE — keeping
 * `open` and an Open World's `shared` Entities reachable by id yet unlisted (ADR-0084's invariant).
 */
function canReadEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  // superadmin short-circuited above, so listing delegates with it resolved to false.
  return sql`(${canListEntity(userId, false)} OR ${entities.visibility} = 'open'
    OR (${entities.visibility} = 'shared' AND ${inAnOpenWorld()}))`;
}

/**
 * The management predicate: `owner ∨ (world-owner ∧ shared)`. Governs the powers a
 * grant never confers — delete, visibility change, grant management. A World Owner's
 * power stops at `private`.
 */
function canWriteEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(${hasGrant(userId, ['owner'])} OR (${entities.visibility} = 'shared' AND ${isWorldOwner(userId)}))`;
}

/**
 * The substance predicate: `canWrite ∨ grant(editor)`. Governs the autosave surface
 * (Content, name, Tags, EntityDocument) — an entity-level Editor edits substance without
 * the lifecycle/exposure powers {@link canWriteEntity} keeps.
 */
function canEditSubstanceEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(${hasGrant(userId, ['owner', 'editor'])} OR (${entities.visibility} = 'shared' AND ${isWorldOwner(userId)}))`;
}

/**
 * The caller's Entity Rights from a resolved access decision. `set-visibility` and
 * `delete` both project from `canWrite`. Order is stable for assertions.
 *
 * A **Sealed** Entity reports `read` and nothing else, whatever the predicates resolved to (ADR-0079):
 * Rights are what a client renders affordances from, and the write choke point would refuse every other
 * verb. Projected here rather than folded into the predicates, so the seal stays what #399 made it — a
 * structural refusal, not a Right.
 */
export function entityRightsOf(a: {
  canRead: boolean;
  canEditSubstance: boolean;
  canWrite: boolean;
  isOwner: boolean;
  sealed: boolean;
}): EntityVerb[] {
  const rights: EntityVerb[] = [];
  if (a.canRead) rights.push('read');
  if (a.sealed) return rights;
  if (a.canEditSubstance) rights.push('edit');
  if (a.canWrite) rights.push('delete', 'set-visibility');
  if (a.isOwner) rights.push('manage');
  return rights;
}

/** A resolved single-row Entity decision: the full row plus the caller's standing. */
export interface EntityDecision {
  row: typeof entities.$inferSelect;
  canRead: boolean;
  canWrite: boolean;
  canEditSubstance: boolean;
  isOwner: boolean;
  /** Whether the row is a **Compendium Entry** — resolved in the same round trip as the standing. */
  sealed: boolean;
}

/**
 * A per-request Entity access context: the authorization rule pre-bound to `userId`,
 * with the Superadmin bypass resolved once. Write paths must ride
 * {@link writeFilter}/{@link editFilter} on the atomic UPDATE WHERE.
 */
export interface EntityAccess {
  /**
   * **Listing** predicate for an enumeration WHERE — browse/search/Palette, facet counts, a World's own
   * entity/pin lists, the graph (`owner ∨ grant ∨ (shared ∧ member) ∨ compendium ∨ (shared ∧ mounted)`).
   * `open` is deliberately absent: listing stays scoped (ADR-0084). Use {@link reachFilter} to resolve a
   * *named* Entity's readability.
   */
  listFilter: ReturnType<typeof canListEntity>;
  /**
   * **Reachability** predicate for resolving a *named* Entity — the References/link-index LEFT JOINs
   * (ADR-0046/0072): {@link listFilter} `∨ open`. A non-member reaches an `open` link target by id, so it
   * resolves here though it never lists.
   */
  reachFilter: ReturnType<typeof canReadEntity>;
  /** Management predicate for a delete / visibility UPDATE WHERE (`owner ∨ (shared ∧ world-owner)`). */
  writeFilter: ReturnType<typeof canWriteEntity>;
  /** Substance predicate for a save / name-patch UPDATE WHERE (`canWrite ∨ grant(editor)`). */
  editFilter: ReturnType<typeof canEditSubstanceEntity>;
  /** The four predicate columns, for a per-row Rights SELECT (list `withRights`, {@link decide}). */
  rightsColumns: {
    canRead: ReturnType<typeof canReadEntity>;
    canEditSubstance: ReturnType<typeof canEditSubstanceEntity>;
    canWrite: ReturnType<typeof canWriteEntity>;
    isOwner: ReturnType<typeof ownsEntity>;
  };
  /** Project a resolved decision to the caller's verbs. */
  rightsOf: typeof entityRightsOf;
  /** Full single-row decision (row + standing), or undefined if no such Entity. */
  decide(id: string): EntityDecision | undefined;
  /**
   * Blob-free reachability + ownership (no `document`), or undefined if no such Entity. The Container
   * rides along, free on a row already read — a caller telling home content from foreign needs it (ADR-0080).
   */
  decideMeta(id: string): { canRead: boolean; isOwner: boolean; containerId: string } | undefined;
}

/** Resolve the Entity access context for `userId` (Superadmin resolved once). */
export function entityAccess(db: Db, userId: string): EntityAccess {
  const superadmin = isSuperadmin(db, userId);
  return {
    listFilter: canListEntity(userId, superadmin),
    reachFilter: canReadEntity(userId, superadmin),
    writeFilter: canWriteEntity(userId, superadmin),
    editFilter: canEditSubstanceEntity(userId, superadmin),
    rightsColumns: {
      canRead: canReadEntity(userId, superadmin),
      canEditSubstance: canEditSubstanceEntity(userId, superadmin),
      canWrite: canWriteEntity(userId, superadmin),
      isOwner: ownsEntity(userId, superadmin),
    },
    rightsOf: entityRightsOf,
    decide(id) {
      const result = db
        .select({
          ...getTableColumns(entities),
          canRead: canReadEntity(userId, superadmin),
          canWrite: canWriteEntity(userId, superadmin),
          canEditSubstance: canEditSubstanceEntity(userId, superadmin),
          isOwner: ownsEntity(userId, superadmin),
          sealed: inACompendium(),
        })
        .from(entities)
        .where(eq(entities.id, id))
        .get();
      if (!result) return undefined;
      // Split the computed 0/1 columns off so `row` is a clean entity row for toDetail.
      const { canRead, canWrite, canEditSubstance, isOwner, sealed, ...row } = result;
      return {
        row,
        canRead: !!canRead,
        canWrite: !!canWrite,
        canEditSubstance: !!canEditSubstance,
        isOwner: !!isOwner,
        sealed: !!sealed,
      };
    },
    decideMeta(id) {
      // Reachability + ownership only, skipping the document blob.
      const row = db
        .select({
          canRead: canReadEntity(userId, superadmin),
          isOwner: ownsEntity(userId, superadmin),
          containerId: entities.containerId,
        })
        .from(entities)
        .where(eq(entities.id, id))
        .get();
      return row ? { canRead: !!row.canRead, isOwner: !!row.isOwner, containerId: row.containerId } : undefined;
    },
  };
}
