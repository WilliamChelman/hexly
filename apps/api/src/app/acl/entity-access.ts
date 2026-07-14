import { EntityVerb, GrantRole } from '@hexly/domain';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { Db } from '../db/db';
import { entities, entityGrants, entityLinks, worldLinks, worldMembers } from '../db/schema';
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
  return sql`EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${entities.worldId} AND ${worldMembers.userId} = ${userId})`;
}

/** The caller is a World Owner (role 'owner') of the Entity's World. */
function isWorldOwner(userId: string) {
  return sql`EXISTS (SELECT 1 FROM ${worldMembers} WHERE ${worldMembers.worldId} = ${entities.worldId} AND ${worldMembers.userId} = ${userId} AND ${worldMembers.role} = 'owner')`;
}

/**
 * The read predicate: `owner ∨ grant(editor|viewer) ∨ (member ∧ shared)`. An Entity
 * the caller can't read is indistinguishable from a missing one, so `private` never
 * leaks existence. An entity-level grant pierces `private` for exactly that user.
 */
function canReadEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(${hasGrant(userId, ['owner', 'editor', 'viewer'])} OR (${entities.visibility} = 'shared' AND ${isWorldMember(userId)}))`;
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
 */
export function entityRightsOf(a: {
  canRead: boolean;
  canEditSubstance: boolean;
  canWrite: boolean;
  isOwner: boolean;
}): EntityVerb[] {
  const rights: EntityVerb[] = [];
  if (a.canRead) rights.push('read');
  if (a.canEditSubstance) rights.push('edit');
  if (a.canWrite) rights.push('delete', 'set-visibility');
  if (a.isOwner) rights.push('manage');
  return rights;
}

/** The `shared` visibility predicate — the surface a Public Link exposes. */
export const sharedVisibility = eq(entities.visibility, 'shared');

/** An anonymous Public Link's Rights: read-only. */
export const READ_ONLY_RIGHTS: readonly EntityVerb[] = ['read'];

/**
 * Whether a Public Link *token* currently grants read of Entity `id`. A token reaches
 * an Entity via a per-entity link pointing at it (pierces `private`), or via a World
 * link whose World holds it *and* it is `shared`. A revoked token reaches nothing.
 */
export function tokenReachesEntity(db: Db, token: string, id: string): boolean {
  const direct = db
    .select({ id: entityLinks.entityId })
    .from(entityLinks)
    .where(and(eq(entityLinks.id, token), eq(entityLinks.entityId, id)))
    .get();
  if (direct) return true;
  const viaWorld = db
    .select({ id: entities.id })
    .from(worldLinks)
    .innerJoin(entities, and(eq(entities.worldId, worldLinks.worldId), eq(entities.id, id), sharedVisibility))
    .where(eq(worldLinks.id, token))
    .get();
  return !!viaWorld;
}

/** A resolved single-row Entity decision: the full row plus the caller's standing. */
export interface EntityDecision {
  row: typeof entities.$inferSelect;
  canRead: boolean;
  canWrite: boolean;
  canEditSubstance: boolean;
  isOwner: boolean;
}

/**
 * A per-request Entity access context: the authorization rule pre-bound to `userId`,
 * with the Superadmin bypass resolved once. Write paths must ride
 * {@link writeFilter}/{@link editFilter} on the atomic UPDATE WHERE.
 */
export interface EntityAccess {
  /** Read predicate for a list/get WHERE (`owner ∨ grant ∨ (shared ∧ member)`). */
  filter: ReturnType<typeof canReadEntity>;
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
  /** Blob-free reachability + ownership (no `document`), or undefined if no such Entity. */
  decideMeta(id: string): { canRead: boolean; isOwner: boolean } | undefined;
}

/** Resolve the Entity access context for `userId` (Superadmin resolved once). */
export function entityAccess(db: Db, userId: string): EntityAccess {
  const superadmin = isSuperadmin(db, userId);
  return {
    filter: canReadEntity(userId, superadmin),
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
        })
        .from(entities)
        .where(eq(entities.id, id))
        .get();
      if (!result) return undefined;
      // Split the computed 0/1 columns off so `row` is a clean entity row for toDetail.
      const { canRead, canWrite, canEditSubstance, isOwner, ...row } = result;
      return {
        row,
        canRead: !!canRead,
        canWrite: !!canWrite,
        canEditSubstance: !!canEditSubstance,
        isOwner: !!isOwner,
      };
    },
    decideMeta(id) {
      // Reachability + ownership only, skipping the document blob.
      const row = db
        .select({
          canRead: canReadEntity(userId, superadmin),
          isOwner: ownsEntity(userId, superadmin),
        })
        .from(entities)
        .where(eq(entities.id, id))
        .get();
      return row ? { canRead: !!row.canRead, isOwner: !!row.isOwner } : undefined;
    },
  };
}
