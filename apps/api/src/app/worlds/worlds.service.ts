import { Inject, Injectable } from '@nestjs/common';
import {
  CreateWorldRequest,
  DEFAULT_WORLD_KIND,
  EntityDetail,
  InboundLinkCount,
  MemberRole,
  PublicLink,
  UpdateWorldRequest,
  WorldDetail,
  WorldMember,
  WorldSummary,
  WorldThemeSource,
} from '@hexly/domain';
import { and, asc, count, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service';
import { AssetMintService } from '../assets/asset-mint.service';
import { AclSetResult, gate, OwnerSetResult, removeOwnerOutcome, userExists } from '../acl/owner-set';
import { mintPublicLink, PublicLinkTable, readPublicLink, revokePublicLink } from '../acl/public-link-store';
import { DB, Db } from '../db/db';
import { loadWorld, worldAccess, worldOwnerFilter, worldRightsOf } from '../acl/world-access';
import { entityAccess, sharedVisibility } from '../acl/entity-access';
import { NudgeBus } from '../events/nudge-bus';
import { ContainerLinksService } from './container-links.service';
import { WorldWrites } from './world-writes';
import { INITIAL_SEQ, containers, entities, WorldRow, worldLinks, worldMembers, worlds } from '../db/schema';

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
    private readonly assetMint: AssetMintService,
    private readonly bus: NudgeBus,
    private readonly writes: WorldWrites,
    private readonly links: ContainerLinksService,
  ) {}

  /**
   * Every World the caller has standing in: a member row (owner/contributor/viewer) OR
   * any entity grant inside the World — so an ex-member who kept Entities, or a
   * non-member grantee, keeps minimal reachability. Each World is listed once
   * however reached.
   *
   * A World reached only through a **Mount** is deliberately absent: a Mount widens what a World may
   * point at, never what its readers appear to have (ADR-0080), so it stays readable and unlisted.
   */
  list(userId: string): WorldSummary[] {
    // A Superadmin's access context returns match-all, so no special case here.
    const access = worldAccess(this.db, userId);
    // Identity comes off the Container, the World-ness off the join (ADR-0078).
    const rows = this.db
      .select({
        id: containers.id,
        name: containers.name,
        // Campaign-or-Shelf rides the listing so the World Index can group by it (ADR-0080). It is
        // carried, never filtered on: the WHERE below is reachability and nothing else.
        kind: worlds.kind,
        createdAt: containers.createdAt,
        updatedAt: containers.updatedAt,
      })
      .from(worlds)
      .innerJoin(containers, eq(containers.id, worlds.id))
      .where(access.listFilter)
      .orderBy(asc(containers.createdAt), asc(containers.id))
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
    // The caller's own contributing standing across the whole page, in one read — the Entity-creation
    // rule is not derivable from the owner set (a Contributor holds no owner row).
    const contributing = access.contributingIn(rows.map((w) => w.id));
    return rows.map((w) => {
      const owners = ownersByWorld.get(w.id) ?? [];
      // Rights fall out of the owner set already fetched; `managedBy` folds the Superadmin bypass.
      return {
        ...w,
        owners,
        rights: access.rightsOf({ isOwner: access.managedBy(owners), canContribute: contributing.has(w.id) }),
      };
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
      // A new World is a campaign unless said otherwise (ADR-0080) — the column's own default,
      // echoed here rather than re-read.
      kind: DEFAULT_WORLD_KIND,
      // The creator is the sole initial Owner, so full Rights.
      owners: [ownerId],
      rights: worldRightsOf({ isOwner: true, canContribute: true }),
      entityCount: 0,
      pinnedEntityIds: [],
      seq: INITIAL_SEQ,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Mint an empty World: the World row and its creator's `owner` membership row land
   * together. Returns the new World id.
   */
  mintWorld(ownerId: string, name: string, now: number = Date.now()): string {
    return this.writes.mint(ownerId, name, now);
  }

  /**
   * Whether `userId` may update World `id` — split out of {@link update} so the route can gate
   * before it parses a body carrying a World Theme, which is a colour parser over untrusted input
   * (ADR-0076). The split is `delete`'s, unchanged: no such World → null, not an Owner →
   * 'forbidden'.
   */
  gateUpdate(userId: string, id: string): 'ok' | 'forbidden' | null {
    // One query resolves existence + ownership (undefined ≡ no such World → 404).
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta) return null;
    return meta.isOwner ? 'ok' : 'forbidden';
  }

  /**
   * Update a World's Owner-curated fields (Owner only): `name`, the ordered
   * `pinnedEntityIds`, the World Theme, and/or campaign-or-Shelf (ADR-0080). Forbidden if not an
   * Owner, null if not found; an absent field is left untouched, and a `null` Theme clears it.
   * Pins are stored verbatim (references, not FKs); the Theme arrives already
   * canonicalised by its schema, the write choke point (ADR-0076).
   * ponytail: stale pin ids filtered on read, not pruned on delete.
   */
  update(userId: string, id: string, patch: UpdateWorldRequest): WorldDetail | 'forbidden' | null {
    const gate = this.gateUpdate(userId, id);
    if (gate !== 'ok') return gate;
    // The gate above already resolved access, so this is the unfiltered read.
    const world = loadWorld(this.db, id);
    if (!world) return null;
    // The write handle bumps `seq`/`updatedAt` and nudges; the response carries the post-write row,
    // so the caller's own write-through advances its held freshness and the server's echo nudge for
    // this very write dedups to nothing.
    const next = this.writes.update(world, patch);
    // Only an Owner reaches update (checked above), so full Rights.
    return this.toDetail(next, userId);
  }

  /**
   * The Worlds whose Theme may be copied into World `id` (#376), for that World's Owner:
   * reachable-but-not-Owner → 403, unreachable → 404.
   *
   * "Another World they own" is decided here and nowhere else. {@link worldOwnerFilter} carries no
   * Superadmin bypass, so the set is the caller's *personal* ownership — a World they merely read is
   * withheld rather than filtered out client-side, which is what keeps this an authorisation answer
   * instead of a picker convenience. `id` itself is excluded ("another"), and so is any World carrying
   * no Theme: there is nothing there to copy, so it is never offered (ADR-0076).
   */
  themeSources(userId: string, id: string): AclSetResult<WorldThemeSource[]> {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const rows = this.db
      .select({ id: containers.id, name: containers.name, theme: worlds.theme })
      .from(worlds)
      .innerJoin(containers, eq(containers.id, worlds.id))
      .where(and(worldOwnerFilter(userId), ne(worlds.id, id), isNotNull(worlds.theme)))
      // By name: the Owner picks by the name they gave it, not by when they made it.
      .orderBy(asc(containers.name), asc(containers.id))
      .all();
    // The column is nullable, so the type needs the narrowing the WHERE already did.
    return { status: 'ok', value: rows.filter((row): row is WorldThemeSource => !!row.theme) };
  }

  /**
   * What deleting this World would break beyond it (ADR-0080, #414): the links pointing in from other
   * Containers, and how many they come from. Owner-gated exactly like the delete it precedes, and
   * advisory only — the delete never consults it, so a World nothing points into and a World fifty
   * Worlds point into are equally deletable.
   */
  inboundLinks(userId: string, id: string): InboundLinkCount | 'forbidden' | null {
    const gate = this.gateUpdate(userId, id);
    return gate === 'ok' ? this.links.countInbound(id) : gate;
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
  removeOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const outcome = removeOwnerOutcome(this.worldOwners(id), targetUserId);
    if (outcome.status !== 'ok') return outcome;
    // ponytail: hard-delete the membership row — correct while every world_members
    // row is an owner (nothing writes contributor/viewer yet). When lower-role grants
    // land, an un-owned member must demote to their prior role here, not be ejected.
    //
    // Removing an Owner deletes their membership row: eviction for them if it ends their
    // reachability, a detail nudge for everyone else, on the World and its `shared` Entities alike
    // (they lose write there too).
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
  addMember(userId: string, id: string, targetUserId: string, role: MemberRole): AclSetResult<WorldMember[]> {
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
  setMemberRole(userId: string, id: string, targetUserId: string, role: MemberRole): AclSetResult<WorldMember[]> {
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
  removeMember(userId: string, id: string, targetUserId: string): AclSetResult<WorldMember[]> {
    // One query resolves reachability + ownership (unreachable ≡ missing → 404).
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta?.reachable) return { status: 'not-found' };
    const isLeave = targetUserId === userId;
    if (!isLeave && !meta.isOwner) return { status: 'forbidden' };
    // ≥1-Owner invariant: refuse a removal that would empty the owner set. A
    // non-owner member isn't in `owners`, so removeOwnerOutcome returns `not-found`
    // for them and never blocks their removal.
    const owners = this.worldOwners(id);
    if (removeOwnerOutcome(owners, targetUserId).status === 'last-owner') return { status: 'last-owner' };
    // Removing *someone else* only touches non-owner members — demoting a co-Owner is the
    // ownership-set endpoints' job. Leaving yourself may drop your own owner row (the ≥1-Owner
    // guard above refused orphaning).
    //
    // Membership removal is eviction for the removed principal: they resolve to `unavailable` on
    // the World and on every `shared` Entity in it, while remaining members get a detail nudge.
    // No row matched → the target isn't a (removable) member — an Owner or unknown user.
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
      .where(and(eq(entities.containerId, id), sharedVisibility))
      .all();
    for (const e of shared) this.bus.emitEntityChange(e.id);
    return { status: 'ok', value: null };
  }

  /**
   * Mint (or dedup to) a World Asset from an upload (#269, ADR-0034, ADR-0065), returning the wrapper
   * **Asset Entity**. Contributor-gated (owner ∨ contributor ∨ Superadmin) — authoring an Asset is
   * Entity-creation-shaped, not a World management power: unreachable → 404, reachable-but-not-contributor
   * → 403. Re-uploading identical bytes returns the existing Asset, first name intact (ADR-0065).
   */
  async uploadAsset(
    userId: string,
    id: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<EntityDetail | 'not-found' | 'forbidden'> {
    const meta = worldAccess(this.db, userId).decideMeta(id);
    if (!meta?.reachable) return 'not-found';
    if (!meta.canContribute) return 'forbidden';
    // Extract Asset Stats + thumbnail (sharp, async) before the synchronous mint (ADR-0065); the gate ran
    // first, so we never do the work for an upload we would refuse.
    const extraction = await this.assetMint.extract(filename, bytes);
    return this.assetMint.mint(userId, id, filename, bytes, extraction).entity;
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
  private toDetail(world: WorldRow, callerId: string): WorldDetail {
    // Both standings come off the one meta read: the owner set can't answer `create-entity`, since a
    // Contributor holds no owner row (ADR-0073). Only reachable Worlds get here, so a miss reads empty.
    const meta = worldAccess(this.db, callerId).decideMeta(world.id);
    // The roster and the whole-Container count are membership-facing: a reader who reaches this World
    // without a member row — through a **Mount** (ADR-0080), or by ADR-0037's ex-member residue — gets
    // no user-id list and a count of what they can actually open, never one that tallies others'
    // `private` rows.
    const owners = meta?.isMember ? this.worldOwners(world.id) : [];
    const [{ value: entityCount }] = this.db
      .select({ value: count() })
      .from(entities)
      .where(
        meta?.isMember
          ? eq(entities.containerId, world.id)
          : and(eq(entities.containerId, world.id), entityAccess(this.db, callerId).filter),
      )
      .all();
    return {
      id: world.id,
      name: world.name,
      kind: world.kind,
      owners,
      rights: worldRightsOf({ isOwner: !!meta?.isOwner, canContribute: !!meta?.canContribute }),
      entityCount,
      // The pin set is redacted on the same line, and for the same reason: a pinned id is an Entity's
      // existence, so handing a Mount reader ids they cannot open — `private` ones among them — would
      // name what the count above deliberately does not tally (ADR-0080).
      pinnedEntityIds: meta?.isMember ? (world.pinnedEntityIds ?? []) : this.readablePins(callerId, world),
      // Omitted rather than null when the World carries none, so "no Theme" is one shape everywhere.
      ...(world.theme ? { theme: world.theme } : {}),
      // The freshness key a live-follower holds and compares each nudge against (ADR-0045).
      seq: world.seq,
      createdAt: world.createdAt,
      updatedAt: world.updatedAt,
    };
  }

  /**
   * The World's pins narrowed to what this caller may actually open — the non-member form of the pin
   * set (ADR-0080). The Owner's curated order is kept, so the Dashboard a Mount reader gets is the
   * Owner's minus the cards that were never theirs.
   */
  private readablePins(callerId: string, world: WorldRow): string[] {
    const pins = world.pinnedEntityIds ?? [];
    if (pins.length === 0) return [];
    const readable = new Set(
      this.db
        .select({ id: entities.id })
        .from(entities)
        .where(and(inArray(entities.id, [...pins]), entityAccess(this.db, callerId).filter))
        .all()
        .map((r) => r.id),
    );
    return pins.filter((id) => readable.has(id));
  }

  /** The World's Owner user ids: `world_members` rows with role 'owner', ordered stably. */
  private worldOwners(worldId: string): string[] {
    return this.db
      .select({ userId: worldMembers.userId })
      .from(worldMembers)
      .where(and(eq(worldMembers.worldId, worldId), eq(worldMembers.role, 'owner')))
      .orderBy(asc(worldMembers.userId))
      .all()
      .map((r) => r.userId);
  }

  /** The World's non-owner members: `world_members` rows with a member role, ordered stably. */
  private worldMembers(worldId: string): WorldMember[] {
    return this.db
      .select({ userId: worldMembers.userId, role: worldMembers.role })
      .from(worldMembers)
      .where(and(eq(worldMembers.worldId, worldId), ne(worldMembers.role, 'owner')))
      .orderBy(asc(worldMembers.userId))
      .all()
      .map((r) => ({ userId: r.userId, role: r.role as MemberRole }));
  }
}
