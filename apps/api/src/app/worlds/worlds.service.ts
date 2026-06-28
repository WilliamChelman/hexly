import { Inject, Injectable } from '@nestjs/common';
import { CreateWorldRequest, WorldDetail, WorldSummary } from '@hexly/domain';
import { and, asc, count, eq, or } from 'drizzle-orm';
import { DB, Db, mintWorldWithHome } from '../db/db';
import { entities, worldMembers, worlds } from '../db/schema';

/**
 * World persistence (ADR-0024). A World groups Entities for one campaign; its
 * Home Entity is the in-world note flagged `is_home`, minted in the same
 * transaction as the World row so the two can never exist apart.
 */
@Injectable()
export class WorldsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Every World the caller can reach (ADR-0024): the ones they own plus the ones
   * they're a named member of. A left join to `world_members` on the caller's id
   * means a row surfaces if they own it OR have a membership — `DISTINCT` collapses
   * the (unlikely) owner-and-member double.
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
   * One World as a Detail if the caller can reach it (owns it or is a member),
   * else `null` — a World the caller has no part in is indistinguishable from one
   * that doesn't exist, so reachability never leaks (ADR-0004).
   */
  get(userId: string, id: string): WorldDetail | null {
    const world = this.reachableWorld(userId, id);
    return world ? this.toDetail(world) : null;
  }

  /** Create a World for `ownerId` with a fresh blank Home note, atomically (ADR-0024). */
  create(ownerId: string, req: CreateWorldRequest): WorldDetail {
    const now = Date.now();
    const { worldId, homeEntityId } = mintWorldWithHome(
      this.db.$client,
      ownerId,
      req.name,
      now,
    );
    return {
      id: worldId,
      name: req.name,
      ownerId,
      homeEntityId,
      // A fresh World holds exactly its Home Entity (#120).
      entityCount: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Rename a World, Owner only (ADR-0024): `'forbidden'` when the caller can't
   * own it, `null` when no such World exists. The World name is the source of
   * truth for its Home Entity's title (ADR-0029), so one transaction writes both
   * `worlds.name` and the Home Entity's `name` — they can never diverge. The Home
   * row's `version` is left untouched (metadata-only, like an entity rename) so a
   * rename never invalidates an in-progress edit's base version.
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
   * Delete a World, Owner only (ADR-0024): `'forbidden'` for a non-Owner, `null`
   * for no such World. The World is the container, so its Entities go with it —
   * deleted first in the same transaction (the Home Entity included), which also
   * satisfies the `entities.world_id` foreign key. `world_members`/`world_links`
   * cascade on the World row; `entity_descriptors` cascade on each Entity.
   * ponytail: hard cascade-delete; add a soft-delete/confirm flow only if users ask.
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

  /** Attach the World's Home Entity id (the `is_home` row) to the stored record. */
  private toDetail(world: typeof worlds.$inferSelect): WorldDetail {
    const home = this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.worldId, world.id), eq(entities.isHome, true)))
      .get();
    // Every World is minted with a Home Entity in one transaction, so this is
    // present for any World that exists; a missing one is corruption (a clear 500).
    if (!home) throw new Error(`World ${world.id} has no Home Entity`);
    // The cascade target (#120): every Entity in the World, the Home included.
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

  /** The World row if `userId` owns it or is a member of it, else undefined (ADR-0024). */
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
