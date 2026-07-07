import { EntityVerb, GrantRole } from '@hexly/domain';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { Db } from '../db/db';
import { entities, entityGrants, entityLinks, worldLinks, worldMembers } from '../db/schema';
import { isSuperadmin } from './owner-set';

/**
 * The Entity authorization rule (ADR-0037), in one home. The SQL predicates below are the
 * single source of truth; {@link entityRightsOf} is the only JS *projector* off them. A read
 * path composes {@link EntityAccess.filter} into its WHERE, a write path rides the matching
 * bound predicate on the atomic UPDATE WHERE, and a single-row endpoint calls {@link
 * EntityAccess.decide}. Superadmin is resolved once per context (see {@link entityAccess}) and
 * closed over by every predicate, so no caller ever re-threads the flag — the "forgot to thread
 * superadmin" leak can't reopen.
 */

/**
 * The Superadmin bypass (ADR-0037, #163): a Superadmin short-circuits each predicate to
 * match-all (`sql`1``), so a repair read/write reaches anything and the set-based `list`/`facets`
 * reads return everything, without a per-row `users` subquery bolted onto every predicate.
 * `superadmin === false` emits the exact collaboration-model SQL, unchanged.
 */
const MATCH_ALL = sql`1`;

/**
 * The stored `entity_grants.role` vocabulary (ADR-0037): the API-facing {@link GrantRole}
 * (`editor`/`viewer`) plus `owner`, the top role folded in from the retired `entity_owners`
 * (migration 0007). Owner is a *stored* role only — it never appears in a grant request body.
 */
type StoredEntityRole = 'owner' | GrantRole;

/**
 * The caller holds a row in the entity ACE set (ADR-0037) whose role is one of `roles`. A
 * per-row EXISTS that composes into any WHERE. `roles` spans the *stored* vocabulary — `owner`
 * (folded in, migration 0007) plus the `editor`/`viewer` grant roles — broader than the
 * API-facing {@link GrantRole}, so it takes {@link StoredEntityRole}.
 */
function hasGrant(userId: string, roles: readonly StoredEntityRole[]) {
  const list = sql.join(
    roles.map((r) => sql`${r}`),
    sql`, `,
  );
  return sql`EXISTS (SELECT 1 FROM ${entityGrants} WHERE ${entityGrants.entityId} = ${entities.id} AND ${entityGrants.userId} = ${userId} AND ${entityGrants.role} IN (${list}))`;
}

/**
 * Ownership predicate (ADR-0037): the caller is one of the Entity's Owners — an `owner`-role
 * grant row (folded from `entity_owners`, migration 0007). A Superadmin short-circuits to
 * match-all (repair). The top-role case of {@link hasGrant}.
 */
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
 * The read predicate (ADR-0037): `owner ∨ grant(editor|viewer) ∨ (member ∧ shared)`. The
 * choke point every read path shares — an Entity the caller can't read is indistinguishable
 * from a missing one (ADR-0004), so `private` things don't even leak their existence. An
 * entity-level grant pierces `private`: it reveals the Entity to exactly that user (#161).
 */
function canReadEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(${hasGrant(userId, ['owner', 'editor', 'viewer'])} OR (${entities.visibility} = 'shared' AND ${isWorldMember(userId)}))`;
}

/**
 * The management predicate (ADR-0037): `owner ∨ (world-owner ∧ shared)`. Governs the powers a
 * grant never confers — delete, visibility change, grant management. An Owner mutates their
 * Entity at any visibility; a World Owner curates only the *shared* surface and this power stops
 * dead at `private`. Rides the atomic UPDATE WHERE so a World Owner's write actually lands.
 */
function canWriteEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  return sql`(${hasGrant(userId, ['owner'])} OR (${entities.visibility} = 'shared' AND ${isWorldOwner(userId)}))`;
}

/**
 * The substance predicate (ADR-0037, #161): `canWrite ∨ grant(editor)`. Governs the autosave
 * surface — Content, name, Tags, Metadata — so an entity-level Editor edits substance without
 * gaining the lifecycle/exposure powers {@link canWriteEntity} keeps.
 */
function canEditSubstanceEntity(userId: string, superadmin: boolean) {
  if (superadmin) return MATCH_ALL;
  // canWrite is `owner ∨ (shared ∧ world-owner)`; folding the extra `∨ grant(editor)` in as a
  // single `grant(owner|editor)` scan keeps one EXISTS on entity_grants, not two.
  return sql`(${hasGrant(userId, ['owner', 'editor'])} OR (${entities.visibility} = 'shared' AND ${isWorldOwner(userId)}))`;
}

/**
 * The caller's Entity Rights from a resolved access decision (ADR-0039) — the single place the
 * verb↔predicate correspondence lives. Each ADR-0037 predicate projects to its verb(s):
 * `set-visibility` and `delete` share `canWrite` (the lifecycle gate), two UI affordances over
 * one rule. Order is stable for assertions.
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

/**
 * The `shared` Entity-visibility predicate (ADR-0037, #162) — the surface a World or Entity
 * Public Link exposes. A named export so the token-scoped read paths (which are an honest
 * `(token) → resource` path with no caller, not a `decide(caller, resource)`) stop hardcoding
 * the string. Composes into any WHERE over `entities`.
 */
export const sharedVisibility = eq(entities.visibility, 'shared');

/**
 * An anonymous Public Link's Rights (ADR-0037, #162): read-only. The token *is* the grant —
 * there's no caller to derive Rights from — so a link read always ships exactly `['read']`,
 * named here so the link paths stop repeating the literal.
 */
export const READ_ONLY_RIGHTS: readonly EntityVerb[] = ['read'];

/**
 * Whether a Public Link *token* currently grants read of Entity `id` (ADR-0037/0044, #175). The
 * token *is* the anonymous grant — there is no caller to derive Rights from — so this is the
 * boolean reachability seam the nudge bus checks for a token principal, mirroring what the
 * unguarded `GET /public/…` routes resolve. A token reaches an Entity two ways:
 *
 * - a per-entity link (`entity_links.id = token`) pointing straight at it (pierces `private`), or
 * - a World link (`world_links.id = token`) whose World holds it *and* it is `shared`.
 *
 * A revoked (deleted-row) token reaches nothing → live eviction rides the same shaping event.
 * Blob-free (no `document`), one cheap query, so it is fine on the per-emit path.
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
    .innerJoin(
      entities,
      and(eq(entities.worldId, worldLinks.worldId), eq(entities.id, id), sharedVisibility),
    )
    .where(eq(worldLinks.id, token))
    .get();
  return !!viaWorld;
}

/** A resolved single-row Entity decision (ADR-0039): the full row plus the caller's standing. */
export interface EntityDecision {
  row: typeof entities.$inferSelect;
  canRead: boolean;
  canWrite: boolean;
  canEditSubstance: boolean;
  isOwner: boolean;
}

/**
 * A per-request Entity access context (ADR-0037/0039): resolves the Superadmin bypass **once**
 * and hands back the ADR-0037 rule pre-bound to `userId`. Read paths compose {@link filter}
 * (and select {@link rightsColumns} for per-row Rights); write paths ride {@link writeFilter} /
 * {@link editFilter} on the atomic UPDATE WHERE; single-row endpoints call {@link decide} (full
 * row) or {@link decideMeta} (blob-free — no `document` — for the owner/grant/link gates).
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
      // Only reachability + ownership, so it skips the document blob (the whole point of
      // keeping it separate from decide) — the owner/grant/link gates never need the body.
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
