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
import { sharedVisibility } from '../acl/entity-access';
import { NudgeBus } from '../events/nudge-bus';
import { WorldWrites } from './world-writes';
import { INITIAL_SEQ, entities, worldLinks, worldMembers, worlds } from '../db/schema';

/** World Public Link table for the shared get/mint/revoke helpers. */
const WORLD_LINK: PublicLinkTable = {
  table: worldLinks,
  id: worldLinks.id,
  fk: worldLinks.worldId,
  newRow: (token, worldId) => ({ id: token, worldId, createdAt: Date.now() }),
};

/**
 * World persistence. A World is minted as just its row plus the creator's
 * ownership — its landing is a derived Dashboard, not a stored Home Entity.
 * World Owners are `world_members` rows with `role: 'owner'`.
 */
@Injectable()
export class WorldsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly assets: AssetsService,
    private readonly bus: NudgeBus,
    private readonly writes: WorldWrites,
  ) {}

  /**
   * Every World the caller can reach: a member row (owner/contributor/viewer) OR
   * any entity grant inside the World — so an ex-member who kept Entities, or a
   * non-member grantee, keeps minimal reachability. Each World is listed once
   * however reached.
   */
  list(userId: string): WorldSummary[] {
    // A Superadmin's access context returns match-all, so no special case here.
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
    // Owner sets for the whole page in one grouped read (a worldOwners() per World
    // would be an N+1). Ordered by user id to match worldOwners()'s stable order.
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
      // Rights fall out of the owner set already fetched; `managedBy` folds the Superadmin bypass.
      return { ...w, owners, rights: access.rightsOf({ isOwner: access.managedBy(owners) }) };
    });
  }

  /**
   * World Detail if reachable, else null — an unreachable World is
   * indistinguishable from a nonexistent one.
   */
  get(userId: string, id: string): WorldDetail | null {
    const world = worldAccess(this.db, userId).decide(id);
    return world ? this.toDetail(world, userId) : null;
  }

  create(ownerId: string, req: CreateWorldRequest): WorldDetail {
    const now = Date.now();
    const worldId = this.mintWorld(ownerId, req.name, now);
    return {
      id: worldId,
      name: req.name,
      // The creator is the sole initial Owner, so full Rights.
      owners: [ownerId],
      rights: worldRightsOf({ isOwner: true }),
      entityCount: 0,
      pinnedEntityIds: [],
      seq: INITIAL_SEQ,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Mint an empty World — the shared trunk behind {@link create}, the vault import,
   * and the seed CLI. The World row and its creator's `owner` membership row land
   * together. Returns the new World id.
   */
  mintWorld(ownerId: string, name: string, now: number = Date.now()): string {
    return this.writes.mint(ownerId, name, now);
  }

  /**
   * Update a World's Owner-curated fields (Owner only): `name` and/or the ordered
   * `pinnedEntityIds`. Forbidden if not an Owner, null if not found; an absent
   * field is left untouched. Pins are stored verbatim (references, not FKs).
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
    // The write handle bumps `seq`/`updatedAt` and nudges; the response carries the post-write row,
    // so the caller's own write-through advances its held freshness and the server's echo nudge for
    // this very write dedups to nothing.
    const next = this.writes.update(world, patch);
    // Only an Owner reaches update (checked above), so full Rights.
    return this.toDetail(next, userId);
  }

  /**
   * Delete a World (Owner only): forbidden if not an Owner, null if not found.
   * Its Entities cascade.
   * ponytail: hard cascade-delete; soft-delete/confirm only if users ask.
   */
  delete(userId: string, id: string): 'ok' | 'forbidden' | null {
    // One query resolves existence + ownership (undefined ≡ no such World → 404).
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta) return null;
    if (!meta.isOwner) return 'forbidden';
    // Deletion is eviction: the rows are gone, so the bus shapes every follower — of the World and
    // of each cascaded Entity — to `unavailable`. Both nudge sets flush from the one commit inside
    // `delete`, i.e. *before* the best-effort filesystem cleanup below: a throwing rmSync
    // (EACCES/EBUSY) must not strand followers on a ghost World whose row is already gone.
    this.writes.delete(id);
    // Rows (incl. `assets`) cascade with the World; the on-disk Asset bytes don't,
    // so drop the World's Asset folder here. Best-effort, after the commit.
    this.assets.deleteWorld(id);
    return 'ok';
  }

  /** The World's ownership set, for an Owner. Reachable-but-not-Owner → 403; unreachable → 404. */
  listOwners(userId: string, id: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    return gate ?? { status: 'ok', value: this.worldOwners(id) };
  }

  /**
   * Add a co-Owner (Owner-only; target must be an existing Instance user).
   * Idempotent — promotes an existing member to `owner` rather than inserting a second row.
   */
  addOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    if (!userExists(this.db, targetUserId)) return { status: 'no-such-user' };
    // Promotion grants `manage` on the World *and* write on its `shared` Entities: a follower
    // already holding either must see the change (their owner/manage actions light up), so the
    // additive path nudges too, not just removals. `membership` fans out to both.
    this.writes.membership(id, (w) => w.upsertOwner(targetUserId));
    return { status: 'ok', value: this.worldOwners(id) };
  }

  /**
   * Remove an Owner (or resign your own ownership): Owner-only. The ≥1-Owner
   * invariant refuses removing the last Owner (`last-owner` → 409). A co-Owner may
   * evict any other Owner, including the creator.
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
    //
    // Removing an Owner deletes their membership row — eviction for them if it ends their
    // reachability, a detail nudge for everyone else, on the World and its `shared` Entities alike
    // (they lose write there too). Same shaping path as removeMember.
    this.writes.membership(id, (w) => w.removeMember(targetUserId, true));
    return outcome;
  }

  /** The World's non-owner member set, for an Owner. Reachable-but-not-Owner → 403; unreachable → 404. */
  listMembers(userId: string, id: string): AclSetResult<WorldMember[]> {
    const gate = this.gateOwnerManagement(userId, id);
    return gate ?? { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * Add a member, or change an existing member's role: Owner-only, target must be
   * an existing Instance user, role ∈ {contributor, viewer}. Upsert on the
   * (world, user) PK.
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
    // Membership is the single choke point (ADR-0044): additive changes nudge too, so a follower
    // gaining/regaining reach — of the World, or of a `shared` Entity in it — reconciles rather
    // than waiting for a focus-refetch.
    this.writes.membership(id, (w) => w.upsertMember(targetUserId, role));
    return { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * Change an existing member's role: Owner-only, role ∈ {contributor, viewer}.
   * Only touches non-owner rows — an unknown user or an Owner is a 404 (Owners are
   * managed through the ownership-set endpoints).
   */
  setMemberRole(
    userId: string,
    id: string,
    targetUserId: string,
    role: MemberRole,
  ): AclSetResult<WorldMember[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    // A role change moves what the member may do with the World's `shared` Entities, so it rides
    // the same fan-out. No row matched → nothing changed → `membership` skips the bump and nudge.
    const changed = this.writes.membership(id, (w) => w.setMemberRole(targetUserId, role));
    if (!changed) return { status: 'not-found' };
    return { status: 'ok', value: this.worldMembers(id) };
  }

  /**
   * Remove a member, or leave a World yourself. Removing someone else is
   * Owner-only; leaving (`targetUserId === userId`) is self-service for any member.
   * The ≥1-Owner invariant refuses a removal that would orphan the World
   * (`last-owner` → 409). Hard delete — a departed member who still owns an Entity
   * in the World keeps minimal reachability (derived, not stored).
   */
  removeMember(
    userId: string,
    id: string,
    targetUserId: string,
  ): AclSetResult<WorldMember[]> {
    // One query resolves reachability + ownership (unreachable ≡ missing → 404).
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta?.reachable) return { status: 'not-found' };
    const isLeave = targetUserId === userId;
    if (!isLeave && !meta.isOwner) return { status: 'forbidden' };
    // ≥1-Owner invariant: refuse a removal that would empty the owner set. A
    // non-owner member isn't in `owners`, so removeOwnerOutcome returns `not-found`
    // for them and never blocks their removal.
    const owners = this.worldOwners(id);
    if (removeOwnerOutcome(owners, targetUserId).status === 'last-owner')
      return { status: 'last-owner' };
    // Removing *someone else* only touches non-owner members — demoting a co-Owner is the
    // ownership-set endpoints' job. Leaving yourself may drop your own owner row (the ≥1-Owner
    // guard above refused orphaning).
    //
    // Membership removal is eviction for the removed principal (world-share loss rides the same
    // shaping path): they resolve to `unavailable` on the World and on every `shared` Entity in it,
    // while remaining members get a detail nudge. No row matched → the target isn't a (removable)
    // member — an Owner or unknown user — and `membership` skips the bump and nudge.
    const removed = this.writes.membership(id, (w) => w.removeMember(targetUserId, isLeave));
    if (!removed) return { status: 'not-found' };
    return { status: 'ok', value: this.worldMembers(id) };
  }

  /** The World's Public Link (active token or null), for an Owner — link administration is Owner-only. */
  getLink(userId: string, id: string): AclSetResult<PublicLink | null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: readPublicLink(this.db, WORLD_LINK, id) };
  }

  /**
   * Mint (or return the existing) World Public Link: Owner-only, one active link
   * per World — a re-mint returns the current token (rotate = revoke + re-mint).
   * The token grants anonymous Viewer over the World's `shared` Entities.
   */
  mintLink(userId: string, id: string): AclSetResult<PublicLink> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    return { status: 'ok', value: mintPublicLink(this.db, WORLD_LINK, id) };
  }

  /**
   * Revoke the World Public Link: Owner-only kill-switch — the token stops
   * resolving immediately. Idempotent.
   */
  revokeLink(userId: string, id: string): AclSetResult<null> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    revokePublicLink(this.db, WORLD_LINK, id);
    // Revoke is eviction for a World-ref follower too (#178): the token now reaches no World, so
    // emit the world-detail event to evict an anonymous open-Dashboard viewer to `unavailable`.
    // An authorized cookie follower re-derives reachable and gets a harmless refresh nudge.
    this.bus.emitWorldChange(id);
    // Revoke is eviction: re-emit each of the World's `shared` Entities so the bus
    // shapes every world-link follower to `unavailable`; a still-authorized follower
    // computes newer-than-held false and no-ops it.
    // ponytail: fans out over *all* the World's shared Entities, not just the followed ones — the
    // bus keeps no per-World interest index. Fine on a small instance; add one if a huge shared
    // World ever makes this loop hurt.
    const shared = this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.worldId, id), sharedVisibility))
      .all();
    for (const e of shared) this.bus.emitEntityChange(e.id);
    return { status: 'ok', value: null };
  }

  /**
   * Gate an owner-set operation: undefined when `userId` may manage `id`'s owners,
   * else the failing {@link OwnerSetResult} — unreachable → 404,
   * reachable-but-not-Owner → 403 (the no-existence-leak split).
   */
  private gateOwnerManagement(
    userId: string,
    id: string,
  ): Extract<OwnerSetResult, { status: 'not-found' | 'forbidden' }> | undefined {
    const meta = worldAccess(this.db, userId).decideMeta(id);
    return gate({ reachable: !!meta?.reachable, isOwner: !!meta?.isOwner });
  }

  // Attach the World's Entity count, ownership set, and the caller's Rights.
  private toDetail(world: typeof worlds.$inferSelect, callerId: string): WorldDetail {
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
      // Rights fall out of the owner set already fetched; `managedBy` folds the Superadmin bypass.
      rights: access.rightsOf({ isOwner: access.managedBy(owners) }),
      entityCount,
      pinnedEntityIds: world.pinnedEntityIds ?? [],
      // The freshness key a live-follower holds and compares each nudge against (ADR-0045).
      seq: world.seq,
      createdAt: world.createdAt,
      updatedAt: world.updatedAt,
    };
  }

  /** The World's Owner user ids: `world_members` rows with role 'owner', ordered stably. */
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

  /** The World's non-owner members: `world_members` rows with a member role, ordered stably. */
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
