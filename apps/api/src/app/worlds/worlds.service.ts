import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateWorldRequest,
  emptyEntityBody,
  MemberRole,
  PublicLink,
  WorldDetail,
  WorldMember,
  WorldSummary,
  WorldVerb,
} from '@hexly/domain';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service';
import {
  AclSetResult,
  gate,
  isSuperadmin,
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
import { worldAccess } from '../acl/world-access';
import { entities, worldLinks, worldMembers, worlds } from '../db/schema';

/**
 * The caller's World Rights (ADR-0039): every reachable World carries `read`; a World Owner
 * (or Superadmin) also `manage` — the one `isOwner` gate behind rename/delete/members/link.
 */
function worldRights(canManage: boolean): WorldVerb[] {
  return canManage ? ['read', 'manage'] : ['read'];
}

/** The World Public Link table for the shared get/mint/revoke helpers (ADR-0037, #162). */
const WORLD_LINK: PublicLinkTable = {
  table: worldLinks,
  id: worldLinks.id,
  fk: worldLinks.worldId,
  newRow: (token, worldId) => ({ id: token, worldId, createdAt: Date.now() }),
};

/**
 * World persistence (ADR-0024). Home Entity (flagged is_home) minted in same
 * transaction as World row so the two can never diverge. Ownership is a symmetric
 * set (ADR-0037): World Owners are `world_members` rows with `role: 'owner'`.
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
      // (ADR-0039). Superadmin manages every World (outside the model, #163).
      return { ...w, owners, rights: worldRights(access.superadmin || owners.includes(userId)) };
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

  // Create World with fresh Home note, atomically (ADR-0024).
  create(ownerId: string, req: CreateWorldRequest): WorldDetail {
    const now = Date.now();
    const { worldId, homeEntityId } = this.mintWorldWithHome(
      ownerId,
      req.name,
      now,
    );
    return {
      id: worldId,
      name: req.name,
      // Fresh World's ownership set is its creator alone (ADR-0037).
      owners: [ownerId],
      // Creator is the sole Owner, so full Rights (ADR-0039).
      rights: worldRights(true),
      homeEntityId,
      // Fresh World holds only Home Entity (#120).
      entityCount: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Mint a World for `ownerId` with a freshly minted blank Home note (ADR-0024) —
   * the shared trunk behind {@link create}, the vault import (ADR-0033), and the
   * seed CLI. The World row, its creator's `owner` membership row, the Home note
   * (`is_home = 1`), and the Home's ownership row are inserted together — no cycle,
   * so a plain transaction (atomicity only) suffices.
   */
  mintWorldWithHome(
    ownerId: string,
    name: string,
    now: number = Date.now(),
  ): { worldId: string; homeEntityId: string } {
    const worldId = randomUUID();
    const homeEntityId = randomUUID();
    const document = JSON.stringify(emptyEntityBody('note'));
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
      sqlite
        .prepare(
          // The Home is locked `shared` (ADR-0037): a World shared with anyone always
          // has a landing page. Its visibility is fixed, like its title and undeletability.
          `INSERT INTO entities (id, world_id, is_home, name, type, tags, visibility, version, document, created_at, updated_at)
           VALUES (?, ?, 1, ?, 'note', '[]', 'shared', 1, ?, ?, ?)`,
        )
        .run(homeEntityId, worldId, name, document, now, now);
      sqlite
        .prepare(`INSERT INTO entity_grants (entity_id, user_id, role) VALUES (?, ?, 'owner')`)
        .run(homeEntityId, ownerId);
    })();
    return { worldId, homeEntityId };
  }

  /**
   * Rename World (Owner only, ADR-0024): forbidden if not an Owner, null if not found.
   * World name is source of truth for Home title (ADR-0029); one transaction
   * ensures sync. Home version untouched (metadata-only) so rename doesn't
   * invalidate in-progress edits.
   */
  rename(
    userId: string,
    id: string,
    name: string,
  ): WorldDetail | 'forbidden' | null {
    const world = this.db.select().from(worlds).where(eq(worlds.id, id)).get();
    if (!world) return null;
    if (!this.isOwner(userId, id)) return 'forbidden';
    const updatedAt = Date.now();
    this.db.transaction(() => {
      this.db
        .update(worlds)
        .set({ name, updatedAt })
        .where(eq(worlds.id, id))
        .run();
      this.db
        .update(entities)
        .set({ name, updatedAt })
        .where(and(eq(entities.worldId, id), eq(entities.isHome, true)))
        .run();
    });
    // Only an Owner reaches rename (checked above), so full Rights.
    return this.toDetail({ ...world, name, updatedAt }, userId);
  }

  /**
   * Delete World (Owner only, ADR-0024): forbidden if not an Owner, null if not found.
   * World is container; Entities cascade (Home included, satisfies FK).
   * ponytail: hard cascade-delete; soft-delete/confirm only if users ask.
   */
  delete(userId: string, id: string): 'ok' | 'forbidden' | null {
    const world = this.db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.id, id))
      .get();
    if (!world) return null;
    if (!this.isOwner(userId, id)) return 'forbidden';
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
    if (!worldAccess(this.db, userId).decide(id)) return { status: 'not-found' };
    const isLeave = targetUserId === userId;
    if (!isLeave && !this.isOwner(userId, id)) return { status: 'forbidden' };
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
    const reachable = !!worldAccess(this.db, userId).decide(id);
    return gate({ reachable, isOwner: reachable && this.isOwner(userId, id) });
  }

  // Attach World's Home Entity id (is_home row), ownership set, and the caller's Rights.
  private toDetail(world: typeof worlds.$inferSelect, callerId: string): WorldDetail {
    const home = this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.worldId, world.id), eq(entities.isHome, true)))
      .get();
    // Home Entity minted with World (one transaction); missing = corruption (500).
    if (!home) throw new Error(`World ${world.id} has no Home Entity`);
    // Cascade target (#120): all Entities in World (Home included).
    const [{ value: entityCount }] = this.db
      .select({ value: count() })
      .from(entities)
      .where(eq(entities.worldId, world.id))
      .all();
    const owners = this.worldOwners(world.id);
    return {
      id: world.id,
      name: world.name,
      owners,
      // Rights fall out of the owner set already fetched (ADR-0039) — free, the same
      // derivation list() uses, no extra isOwner query. Superadmin manages every World (#163).
      rights: worldRights(owners.includes(callerId) || this.isSuperadmin(callerId)),
      homeEntityId: home.id,
      entityCount,
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

  /** Whether `userId` is a Superadmin — the outside-the-model repair bypass (ADR-0037, #163). */
  private isSuperadmin(userId: string): boolean {
    return isSuperadmin(this.db, userId);
  }

  /**
   * Whether `userId` is an Owner of World `id` (a `world_members` row with role 'owner'), or
   * the Superadmin — so rename/delete/owner-management (ADR-0037, #163) accept the repair tier.
   */
  private isOwner(userId: string, id: string): boolean {
    if (this.isSuperadmin(userId)) return true;
    return !!this.db
      .select({ userId: worldMembers.userId })
      .from(worldMembers)
      .where(
        and(
          eq(worldMembers.worldId, id),
          eq(worldMembers.userId, userId),
          eq(worldMembers.role, 'owner'),
        ),
      )
      .get();
  }
}
