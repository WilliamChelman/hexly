import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CreateWorldRequest, emptyEntityBody, WorldDetail, WorldSummary } from '@hexly/domain';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { AssetsService } from '../assets/assets.service';
import { OwnerSetResult, removeOwnerOutcome, userExists } from '../acl/owner-set';
import { DB, Db } from '../db/db';
import { entities, worldMembers, worlds } from '../db/schema';

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
   * Every World the caller can reach (ADR-0024): owned or member of. Ownership is
   * now a membership row (ADR-0037), so a single join on `world_members` covers
   * both — DISTINCT guards against a user holding more than one row per World.
   */
  list(userId: string): WorldSummary[] {
    const rows = this.db
      .selectDistinct({
        id: worlds.id,
        name: worlds.name,
        createdAt: worlds.createdAt,
        updatedAt: worlds.updatedAt,
      })
      .from(worlds)
      .innerJoin(worldMembers, eq(worldMembers.worldId, worlds.id))
      .where(eq(worldMembers.userId, userId))
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
          inArray(worldMembers.worldId, rows.map((w) => w.id)),
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
    return rows.map((w) => ({ ...w, owners: ownersByWorld.get(w.id) ?? [] }));
  }

  /**
   * World Detail if reachable (owned or member), else null.
   * Unreachable World indistinguishable from nonexistent (ADR-0004).
   */
  get(userId: string, id: string): WorldDetail | null {
    const world = this.reachableWorld(userId, id);
    return world ? this.toDetail(world) : null;
  }

  // Create World with fresh Home note, atomically (ADR-0024).
  create(ownerId: string, req: CreateWorldRequest): WorldDetail {
    const now = Date.now();
    const { worldId, homeEntityId } = this.mintWorldWithHome(ownerId, req.name, now);
    return {
      id: worldId,
      name: req.name,
      // Fresh World's ownership set is its creator alone (ADR-0037).
      owners: [ownerId],
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
          `INSERT INTO entities (id, world_id, is_home, name, type, tags, visibility, version, document, created_at, updated_at)
           VALUES (?, ?, 1, ?, 'note', '[]', 'private', 1, ?, ?, ?)`,
        )
        .run(homeEntityId, worldId, name, document, now, now);
      sqlite
        .prepare(`INSERT INTO entity_owners (entity_id, user_id) VALUES (?, ?)`)
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
      this.db.update(worlds).set({ name, updatedAt }).where(eq(worlds.id, id)).run();
      this.db
        .update(entities)
        .set({ name, updatedAt })
        .where(and(eq(entities.worldId, id), eq(entities.isHome, true)))
        .run();
    });
    return this.toDetail({ ...world, name, updatedAt });
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
      // entity_owners cascades with its entities; delete entities explicitly.
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
    return gate ?? { status: 'ok', owners: this.worldOwners(id) };
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
    return { status: 'ok', owners: this.worldOwners(id) };
  }

  /**
   * Remove an Owner from a World, or resign your own ownership (ADR-0037): Owner-only.
   * The ≥1-Owner invariant refuses removing the last Owner (`last-owner` → 409). A
   * co-Owner may evict any other Owner, including the creator — no hidden hierarchy.
   */
  removeOwner(userId: string, id: string, targetUserId: string): OwnerSetResult {
    const gate = this.gateOwnerManagement(userId, id);
    if (gate) return gate;
    const outcome = removeOwnerOutcome(this.worldOwners(id), targetUserId);
    if (outcome.status !== 'ok') return outcome;
    // ponytail: hard-delete the membership row — correct while every world_members
    // row is an owner (nothing writes contributor/viewer yet). When lower-role grants
    // land, an un-owned member must demote to their prior role here, not be ejected.
    this.db
      .delete(worldMembers)
      .where(and(eq(worldMembers.worldId, id), eq(worldMembers.userId, targetUserId)))
      .run();
    return outcome;
  }

  /**
   * Gate an owner-set operation: null when `userId` may manage `id`'s owners,
   * else the failing {@link OwnerSetResult}. Unreachable → 404, reachable-but-not-Owner
   * → 403 (the no-existence-leak split, ADR-0037).
   */
  private gateOwnerManagement(
    userId: string,
    id: string,
  ): Extract<OwnerSetResult, { status: 'not-found' | 'forbidden' }> | null {
    if (!this.reachableWorld(userId, id)) return { status: 'not-found' };
    if (!this.isOwner(userId, id)) return { status: 'forbidden' };
    return null;
  }

  // Attach World's Home Entity id (is_home row) and ownership set to stored record.
  private toDetail(world: typeof worlds.$inferSelect): WorldDetail {
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
    return {
      id: world.id,
      name: world.name,
      owners: this.worldOwners(world.id),
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
      .where(and(eq(worldMembers.worldId, worldId), eq(worldMembers.role, 'owner')))
      .orderBy(asc(worldMembers.userId))
      .all()
      .map((r) => r.userId);
  }

  // World row if userId owns or is a member, else undefined (ADR-0024, ADR-0037).
  private reachableWorld(
    userId: string,
    id: string,
  ): typeof worlds.$inferSelect | undefined {
    const world = this.db
      .select()
      .from(worlds)
      .where(eq(worlds.id, id))
      .get();
    if (!world) return undefined;
    const member = this.db
      .select({ userId: worldMembers.userId })
      .from(worldMembers)
      .where(and(eq(worldMembers.worldId, id), eq(worldMembers.userId, userId)))
      .get();
    return member ? world : undefined;
  }

  /** Whether `userId` is an Owner of World `id` (a `world_members` row with role 'owner'). */
  private isOwner(userId: string, id: string): boolean {
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
