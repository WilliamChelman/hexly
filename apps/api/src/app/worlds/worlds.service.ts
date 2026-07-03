import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CreateWorldRequest, emptyEntityBody, WorldDetail, WorldSummary } from '@hexly/domain';
import { and, asc, count, eq, or } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { entities, worldMembers, worlds } from '../db/schema';

/**
 * World persistence (ADR-0024). Home Entity (flagged is_home) minted in same
 * transaction as World row so the two can never diverge.
 */
@Injectable()
export class WorldsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Every World the caller can reach (ADR-0024): owned or member of.
   * Left join on world_members collapses owner-and-member double via DISTINCT.
   */
  list(userId: string): WorldSummary[] {
    return this.db
      .selectDistinct({
        id: worlds.id,
        name: worlds.name,
        ownerId: worlds.ownerId,
        createdAt: worlds.createdAt,
        updatedAt: worlds.updatedAt,
      })
      .from(worlds)
      .leftJoin(worldMembers, eq(worldMembers.worldId, worlds.id))
      .where(or(eq(worlds.ownerId, userId), eq(worldMembers.userId, userId)))
      .orderBy(asc(worlds.createdAt), asc(worlds.id))
      .all();
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
      ownerId,
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
   * seed CLI. The World row is inserted first, then its Home note (`is_home = 1`)
   * references it — no cycle, so a plain transaction (atomicity only) suffices.
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
          `INSERT INTO worlds (id, name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?)`,
        )
        .run(worldId, name, ownerId, now, now);
      sqlite
        .prepare(
          `INSERT INTO entities (id, owner_id, world_id, is_home, name, type, tags, visibility, version, document, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, 'note', '[]', 'private', 1, ?, ?, ?)`,
        )
        .run(homeEntityId, ownerId, worldId, name, document, now, now);
    })();
    return { worldId, homeEntityId };
  }

  /**
   * Rename World (Owner only, ADR-0024): forbidden if not owner, null if not found.
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
    if (world.ownerId !== userId) return 'forbidden';
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
   * Delete World (Owner only, ADR-0024): forbidden if not owner, null if not found.
   * World is container; Entities cascade (Home included, satisfies FK).
   * ponytail: hard cascade-delete; soft-delete/confirm only if users ask.
   */
  delete(userId: string, id: string): 'ok' | 'forbidden' | null {
    const world = this.db
      .select({ ownerId: worlds.ownerId })
      .from(worlds)
      .where(eq(worlds.id, id))
      .get();
    if (!world) return null;
    if (world.ownerId !== userId) return 'forbidden';
    this.db.transaction(() => {
      this.db.delete(entities).where(eq(entities.worldId, id)).run();
      this.db.delete(worlds).where(eq(worlds.id, id)).run();
    });
    return 'ok';
  }

  // Attach World's Home Entity id (is_home row) to stored record.
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
      ownerId: world.ownerId,
      homeEntityId: home.id,
      entityCount,
      createdAt: world.createdAt,
      updatedAt: world.updatedAt,
    };
  }

  // World row if userId owns or is member, else undefined (ADR-0024).
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
    if (world.ownerId === userId) return world;
    const member = this.db
      .select({ userId: worldMembers.userId })
      .from(worldMembers)
      .where(and(eq(worldMembers.worldId, id), eq(worldMembers.userId, userId)))
      .get();
    return member ? world : undefined;
  }
}
