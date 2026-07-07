import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateWorldRequest,
  MemberRole,
  PublicLink,
  WorldDetail,
  WorldMember,
  WorldSummary,
} from '@hexly/domain';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service';
import {
  AclSetResult,
  gate,
  OwnerSetResult,
  removeOwnerOutcome,
  userExists,
} from '../acl/owner-set';
import {
  mintPublicLink,
  PublicLinkTable,
  readPublicLink,
  revokePublicLink,
} from '../acl/public-link-store';
import { DB, Db } from '../db/db';
import { worldAccess, worldRightsOf } from '../acl/world-access';
import { entities, worldLinks, worldMembers, worlds } from '../db/schema';

/** The World Public Link table for the shared get/mint/revoke helpers (ADR-0037, #162). */
const WORLD_LINK: PublicLinkTable = {
  table: worldLinks,
  id: worldLinks.id,
  fk: worldLinks.worldId,
  newRow: (token, worldId) => ({ id: token, worldId, createdAt: Date.now() }),
};

/**
 * World persistence (ADR-0024). A World is minted as just its row plus the creator's
 * ownership — its landing is a derived World Dashboard, not a stored Home Entity
 * (ADR-0043). Ownership is a symmetric set (ADR-0037): World Owners are `world_members`
 * rows with `role: 'owner'`.
 */
@Injectable()
export class WorldsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  /**
   * Every World the caller can reach (ADR-0024, ADR-0037): reachability is derived —
   * a member row (owner/contributor/viewer), OR any row in an Entity's ACE set inside the
   * World. That one set now spans ownership *and* entity-level grants (owner folded into
   * entity_grants, migration 0007): an ex-member who kept Entities keeps minimal reachability,
   * and a grantee can navigate to what they were given even as a non-member (#161). The id
   * sets are unioned so a World is listed once however reached.
   */
  list(userId: string): WorldSummary[] {
    // Reachability (member row OR any entity grant inside) is the one derived predicate the
    // access context owns — a Superadmin's context returns match-all, so `list` sees every
    // World without a special case here (ADR-0037, #163).
    const access = worldAccess(this.db, userId);
    const rows = this.db
      .select({
        id: worlds.id,
        name: worlds.name,
        createdAt: worlds.createdAt,
        updatedAt: worlds.updatedAt,
      })
      .from(worlds)
      .where(access.reachFilter)
      .orderBy(asc(worlds.createdAt), asc(worlds.id))
      .all();
    if (rows.length === 0) return [];
    // Owner sets for the whole page in one grouped read (not a worldOwners() per
    // World — that was an N+1 on the World-index hot path). Ordered by user id so
    // each World's list matches worldOwners()'s stable order.
    const ownerRows = this.db
      .select({ worldId: worldMembers.worldId, userId: worldMembers.userId })
      .from(worldMembers)
      .where(
        and(
          inArray(
            worldMembers.worldId,
            rows.map((w) => w.id),
          ),
          eq(worldMembers.role, 'owner'),
        ),
      )
      .orderBy(asc(worldMembers.userId))
      .all();
    const ownersByWorld = new Map<string, string[]>();
    for (const { worldId, userId } of ownerRows) {
      const list = ownersByWorld.get(worldId);
      if (list) list.push(userId);
      else ownersByWorld.set(worldId, [userId]);
    }
    return rows.map((w) => {
      const owners = ownersByWorld.get(w.id) ?? [];
      // Rights fall out of the owner set already fetched — free, so summaries always carry them
      // (ADR-0039). `managedBy` folds the Superadmin bypass (outside the model, #163).
      return { ...w, owners, rights: access.rightsOf({ isOwner: access.managedBy(owners) }) };
    });
  }

  /**
   * World Detail if reachable (owned or member), else null.
   * Unreachable World indistinguishable from nonexistent (ADR-0004).
   */
  get(userId: string, id: string): WorldDetail | null {
    const world = worldAccess(this.db, userId).decide(id);
    return world ? this.toDetail(world, userId) : null;
  }

  // Create an empty World (ADR-0024, ADR-0043): just the World row and its creator's ownership.
  create(ownerId: string, req: CreateWorldRequest): WorldDetail {
    const now = Date.now();
    const worldId = this.mintWorld(ownerId, req.name, now);
    return {
      id: worldId,
      name: req.name,
      // Fresh World's ownership set is its creator alone (ADR-0037).
      owners: [ownerId],
      // Creator is the sole Owner, so full Rights (ADR-0039).
      rights: worldRightsOf({ isOwner: true }),
      // A fresh World seeds no Entities — its landing is a derived Dashboard (ADR-0043).
      entityCount: 0,
      // No Pinned Entities until an Owner curates them (ADR-0043, #168).
      pinnedEntityIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Mint an empty World for `ownerId` (ADR-0024, ADR-0043) — the shared trunk behind
   * {@link create}, the vault import (ADR-0033), and the seed CLI. The World row and its
   * creator's `owner` membership row are inserted together; the landing page is a derived
   * World Dashboard, so no Home note is minted. Returns the new World id.
   */
  mintWorld(ownerId: string, name: string, now: number = Date.now()): string {
    const worldId = randomUUID();
    const sqlite = this.db.$client;
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO worlds (id, name, created_at, updated_at) VALUES (?,?,?,?)`,
        )
        .run(worldId, name, now, now);
      sqlite
        .prepare(
          `INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'owner')`,
        )
        .run(worldId, ownerId);
    })();
    return worldId;
  }

  /**
   * Update a World's Owner-curated fields (Owner only, ADR-0024, ADR-0043, #168):
   * the `name` (rename) and/or the ordered `pinnedEntityIds` set. Forbidden if not an
   * Owner, null if not found. Both fields optional — an absent one is left untouched.
   * Pins are stored verbatim (references, not FKs): stale/inaccessible ids are filtered
   * per-viewer on the read path, never pruned here.
   * ponytail: stale pin ids filtered on read, not pruned on delete.
   */
  update(
    userId: string,
    id: string,
    patch: { name?: string; pinnedEntityIds?: string[] },
  ): WorldDetail | 'forbidden' | null {
    const world = this.db.select().from(worlds).where(eq(worlds.id, id)).get();
    if (!world) return null;
    if (!worldAccess(this.db, userId).decideMeta(id)?.isOwner) return 'forbidden';
    const updatedAt = Date.now();
    const next = {
      ...world,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.pinnedEntityIds !== undefined
        ? { pinnedEntityIds: patch.pinnedEntityIds }
        : {}),
      updatedAt,
    };
    this.db
      .update(worlds)
      .set({ name: next.name, pinnedEntityIds: next.pinnedEntityIds, updatedAt })
      .where(eq(worlds.id, id))
      .run();
    // Only an Owner reaches update (checked above), so full Rights.
    return this.toDetail(next, userId);
  }

  /**
   * Delete World (Owner only, ADR-0024): forbidden if not an Owner, null if not found.
   * World is container; Entities cascade (Home included, satisfies FK).
   * ponytail: hard cascade-delete; soft-delete/confirm only if users ask.
   */
  delete(userId: string, id: string): 'ok' | 'forbidden' | null {
    // One query resolves existence + ownership (undefined ≡ no such World → 404).
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta) return null;
    if (!meta.isOwner) return 'forbidden';
    this.db.transaction(() => {
      // entity_grants cascades with its entities; delete entities explicitly.
      this.db.delete(entities).where(eq(entities.worldId, id)).run();
      this.db.delete(worlds).where(eq(worlds.id, id)).run();
    });
    // Rows (incl. `assets`) cascade with the World; the on-disk Asset bytes don't, so
    // drop the World's whole Asset folder here (ADR-0034). Best-effort, after the commit.
    this.assets.deleteWorld(id);
    return 'ok';
  }

  /**
   * The World's ownership set, for an Owner (ADR-0037). Reachable-but-not-Owner is
   * a 403; unreachable a 404 — the controller maps the result.
   */
  listOwners(userId: string, id: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    return gate ?? { status: 'ok', value: this.worldOwners(id) };
  }

  /**
   * Add a co-Owner to a World (ADR-0037): Owner-only, the target must be an existing
   * Instance user. Idempotent — adding an existing Owner is a no-op that still returns
   * the set. Promotes an existing member to `owner` rather than inserting a second row.
   */
  addOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    this.db.$client
      .prepare(
        `INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'owner')
         ON CONFLICT(world_id, user_id) DO UPDATE SET role = 'owner'`,
      )
      .run(id, targetUserId);
    return { status: 'ok', value: this.worldOwners(id) };
  }

  /**
   * Remove an Owner from a World, or resign your own ownership (ADR-0037): Owner-only.
   * The ≥1-Owner invariant refuses removing the last Owner (`last-owner` → 409). A
   * co-Owner may evict any other Owner, including the creator — no hidden hierarchy.
   */
  removeOwner(
    userId: string,
    id: string,
    targetUserId: string,
  ): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const outcome = removeOwnerOutcome(this.worldOwners(id), targetUserId);
    if (outcome.status !== 'ok') return outcome;
    // ponytail: hard-delete the membership row — correct while every world_members
    // row is an owner (nothing writes contributor/viewer yet). When lower-role grants
    // land, an un-owned member must demote to their prior role here, not be ejected.
    this.db
      .delete(worldMembers)
      .where(
        and(
          eq(worldMembers.worldId, id),
          eq(worldMembers.userId, targetUserId),
        ),
      )
      .run();
    return outcome;
  }

  /**
   * The World's non-owner member set, for an Owner (ADR-0037, #159). Reachable-but-not-Owner
   * is a 403; unreachable a 404 — the controller maps the result.
   */
  listMembers(userId: string, id: string): AclSetResult<WorldMember[]> {
    const gate = this.gateOwnerManagement(userId, id);
    return gate ?? { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * Add a member to a World, or change an existing member's role (ADR-0037, #159):
   * Owner-only, the target must be an existing Instance user, role ∈ {contributor,
   * viewer}. Upsert — re-adding an existing member updates their role rather than
   * duplicating the row (the PK is (world, user)).
   */
  addMember(
    userId: string,
    id: string,
    targetUserId: string,
    role: MemberRole,
  ): AclSetResult<WorldMember[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    // The `WHERE role != 'owner'` makes adding an existing Owner a no-op: a member role
    // can never overwrite ownership here (that would risk orphaning the World, ADR-0037).
    // Demoting an Owner belongs to the ownership-set endpoints, not member management.
    this.db.$client
      .prepare(
        `INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(world_id, user_id) DO UPDATE SET role = excluded.role
         WHERE world_members.role != 'owner'`,
      )
      .run(id, targetUserId, role);
    return { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * Change an existing member's role (ADR-0037, #159): Owner-only, role ∈ {contributor,
   * viewer}. Only touches non-owner member rows — an unknown user or an Owner is a 404
   * (Owners are managed through the ownership-set endpoints, not here).
   */
  setMemberRole(
    userId: string,
    id: string,
    targetUserId: string,
    role: MemberRole,
  ): AclSetResult<WorldMember[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const updated = this.db
      .update(worldMembers)
      .set({ role })
      .where(
        and(
          eq(worldMembers.worldId, id),
          eq(worldMembers.userId, targetUserId),
          ne(worldMembers.role, 'owner'),
        ),
      )
      .run();
    if (updated.changes === 0) return { status: 'not-found' };
    return { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * Remove a member, or leave a World yourself (ADR-0037, #159). Removing someone else
   * is Owner-only; leaving (`targetUserId === userId`) is self-service for any member.
   * The ≥1-Owner invariant refuses a removal that would orphan the World (`last-owner`
   * → 409). The row is hard-deleted — access simply recomputes; a departed member who
   * still owns an Entity in the World keeps minimal reachability (derived, not stored).
   */
  removeMember(
    userId: string,
    id: string,
    targetUserId: string,
  ): AclSetResult<WorldMember[]> {
    // One query resolves reachability + ownership (unreachable ≡ missing → 404, ADR-0004).
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta?.reachable) return { status: 'not-found' };
    const isLeave = targetUserId === userId;
    if (!isLeave && !meta.isOwner) return { status: 'forbidden' };
    // The ≥1-Owner invariant, shared with the owner-set endpoints (ADR-0037): refuse a removal
    // that would empty the set. A non-owner member isn't in `owners`, so removeOwnerOutcome
    // returns `not-found` (not `last-owner`) for them and this never blocks their removal.
    const owners = this.worldOwners(id);
    if (removeOwnerOutcome(owners, targetUserId).status === 'last-owner')
      return { status: 'last-owner' };
    const deleted = this.db
      .delete(worldMembers)
      .where(
        and(
          eq(worldMembers.worldId, id),
          eq(worldMembers.userId, targetUserId),
          // Removing *someone else* only touches non-owner members — demoting a
          // co-Owner is the ownership-set endpoints' job (ADR-0037), never member
          // management. Leaving yourself may drop your own owner row (the ≥1-Owner
          // guard above already refused orphaning the World).
          ...(isLeave ? [] : [ne(worldMembers.role, 'owner')]),
        ),
      )
      .run();
    // No row matched: the target isn't a (removable) member — an Owner or unknown user.
    if (deleted.changes === 0) return { status: 'not-found' };
    return { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * The World's Public Link, for an Owner (ADR-0037, #162): the active token or null. Link
   * administration is a World Owner power (like membership) — unreachable → 404, reachable
   * but not an Owner → 403 (the controller maps the outcome).
   */
  getLink(userId: string, id: string): AclSetResult<PublicLink | null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: readPublicLink(this.db, WORLD_LINK, id) };
  }

  /**
   * Mint (or return the existing) World Public Link (ADR-0037, #162): World-Owner-only. One
   * active link per World — a re-mint returns the current token rather than rotating it, so
   * the shared URL stays stable (rotate = revoke + re-mint). The token grants anonymous World
   * Viewer over `shared` Entities; revoking it is the kill-switch (ADR-0004).
   */
  mintLink(userId: string, id: string): AclSetResult<PublicLink> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: mintPublicLink(this.db, WORLD_LINK, id) };
  }

  /**
   * Revoke the World Public Link (ADR-0037, #162): World-Owner-only, the kill-switch. A plain
   * row delete after which the token route stops resolving immediately. Idempotent.
   */
  revokeLink(userId: string, id: string): AclSetResult<null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    revokePublicLink(this.db, WORLD_LINK, id);
    return { status: 'ok', value: null };
  }

  /**
   * Gate an owner-set operation: null when `userId` may manage `id`'s owners,
   * else the failing {@link OwnerSetResult}. Unreachable → 404, reachable-but-not-Owner
   * → 403 (the no-existence-leak split, ADR-0037).
   */
  private gateOwnerManagement(
    userId: string,
    id: string,
  ): Extract<OwnerSetResult, { status: 'not-found' | 'forbidden' }> | undefined {
    // One query for both facts — decideMeta collapses the former decide()-then-isOwner() pair.
    const meta = worldAccess(this.db, userId).decideMeta(id);
    return gate({ reachable: !!meta?.reachable, isOwner: !!meta?.isOwner });
  }

  // Attach the World's Entity count, ownership set, and the caller's Rights.
  private toDetail(world: typeof worlds.$inferSelect, callerId: string): WorldDetail {
    // Cascade target (#120): every Entity in the World.
    const [{ value: entityCount }] = this.db
      .select({ value: count() })
      .from(entities)
      .where(eq(entities.worldId, world.id))
      .all();
    const owners = this.worldOwners(world.id);
    const access = worldAccess(this.db, callerId);
    return {
      id: world.id,
      name: world.name,
      owners,
      // Rights fall out of the owner set already fetched (ADR-0039) — free, the same derivation
      // list() uses, no extra isOwner query. `managedBy` folds the Superadmin bypass (#163).
      rights: access.rightsOf({ isOwner: access.managedBy(owners) }),
      entityCount,
      // The stored Owner-curated pin set (ADR-0043, #168); [] on a fresh World.
      pinnedEntityIds: world.pinnedEntityIds ?? [],
      createdAt: world.createdAt,
      updatedAt: world.updatedAt,
    };
  }

  /** The World's Owner user ids (ADR-0037): `world_members` rows with role 'owner', ordered stably. */
  private worldOwners(worldId: string): string[] {
    return this.db
      .select({ userId: worldMembers.userId })
      .from(worldMembers)
      .where(
        and(eq(worldMembers.worldId, worldId), eq(worldMembers.role, 'owner')),
      )
      .orderBy(asc(worldMembers.userId))
      .all()
      .map((r) => r.userId);
  }

  /** The World's non-owner members (ADR-0037): `world_members` rows with a member role, ordered stably. */
  private worldMembers(worldId: string): WorldMember[] {
    return this.db
      .select({ userId: worldMembers.userId, role: worldMembers.role })
      .from(worldMembers)
      .where(
        and(eq(worldMembers.worldId, worldId), ne(worldMembers.role, 'owner')),
      )
      .orderBy(asc(worldMembers.userId))
      .all()
      .map((r) => ({ userId: r.userId, role: r.role as MemberRole }));
  }
}
