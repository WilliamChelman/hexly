import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { FieldSchema, MemberRole, UserDefinedType, WorldTheme } from '@hexly/domain';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import {
  containerMounts,
  containers,
  WorldRow,
  worldFields,
  worldMembers,
  worlds,
  worldTypes,
  WORLD_CONTAINER_KIND,
} from '../db/schema';
import { SyncOnly, WriteOutbox } from '../events/write-outbox';
import { EntityWrites } from '../entities/entity-writes';

/**
 * The narrow handle a membership change writes `world_members` rows through. Runs inside the
 * transaction, before the `seq` bump.
 *
 * A writer that matched no row leaves the World untouched: {@link WorldWrites.membership} then
 * skips the bump and the nudge and reports `false`.
 */
export interface MembershipWriter {
  /** Promote to Owner — deliberately overwrites any contributor/viewer role the target held. */
  upsertOwner(targetUserId: string): void;
  /**
   * Add a member, or change an existing member's role. An `owner` row wins: a member role must
   * never overwrite ownership (risk of orphaning the World) — demoting an Owner belongs to the
   * ownership-set endpoints.
   */
  upsertMember(targetUserId: string, role: MemberRole): void;
  /** Re-role an existing non-owner member. Matches nothing for an Owner, or an unknown user. */
  setMemberRole(targetUserId: string, role: MemberRole): void;
  /**
   * Remove a member. `allowOwner` lets a self-leave drop the caller's own `owner` row; removing
   * *someone else* never touches one.
   */
  removeMember(targetUserId: string, allowOwner: boolean): void;
}

/**
 * The single write handle for a World — its `containers` identity row (ADR-0078), its `worlds`
 * satellite and `world_members` (ADR-0045). It owns the `seq` bump, the post-commit emit, and the
 * fan-out to the World's shared Entities. An ESLint rule bans `insert|update|delete(worlds)` and
 * `(worldMembers)` everywhere else, and `(containers)` everywhere but here and {@link CompendiumWrites}
 * — the identity table is the one both kinds of Container write (ADR-0079).
 *
 * A World membership change moves Rights on two resources at once — the World, and every `shared`
 * Entity in it (`canRead` = `… ∨ (shared ∧ world-member)`, `canWrite` = `… ∨ (shared ∧ world-owner)`).
 */
@Injectable()
export class WorldWrites {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: WriteOutbox,
    private readonly entities: EntityWrites,
  ) {}

  /** Run `fn` in the outermost transaction, flushing the nudge outbox on commit. */
  transact<T>(fn: () => SyncOnly<T>): T {
    return this.outbox.transact(fn);
  }

  /**
   * Insert an empty World — its Container identity row, its `worlds` satellite, and its creator's
   * `owner` membership together, so a new World is never ownerless. Returns the new World id, which
   * is also its container id (ADR-0078). No nudge: nothing can be following an id that did not
   * exist a moment ago.
   */
  mint(ownerId: string, name: string, now: number = Date.now()): string {
    const id = randomUUID();
    return this.transact(() => {
      this.db.insert(containers).values({ id, kind: WORLD_CONTAINER_KIND, name, createdAt: now, updatedAt: now }).run();
      this.db.insert(worlds).values({ id }).run();
      this.db.insert(worldMembers).values({ worldId: id, userId: ownerId, role: 'owner' }).run();
      return id;
    });
  }

  /**
   * Write a World's Owner-curated fields — `name`, the ordered `pinnedEntityIds`, and/or the World
   * Theme. Both timestamps move, unlike {@link membership} which moves `seq` alone. An absent field
   * is left untouched; a `null` Theme clears it.
   *
   * The post-write `seq` is computed in JS and used for both the SET and the returned row, so the
   * caller's write-through holds exactly what the row holds and the server's echo nudge for this
   * write dedups to nothing. Safe because `better-sqlite3` is synchronous and the read rode the
   * same transaction.
   */
  update(row: WorldRow, patch: { name?: string; pinnedEntityIds?: string[]; theme?: WorldTheme | null }): WorldRow {
    const next: WorldRow = {
      ...row,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.pinnedEntityIds !== undefined ? { pinnedEntityIds: patch.pinnedEntityIds } : {}),
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
      updatedAt: Date.now(),
      seq: row.seq + 1,
    };
    return this.transact(() => {
      // Identity and freshness on the Container, pins and Theme on the satellite (ADR-0078).
      this.db
        .update(containers)
        .set({ name: next.name, updatedAt: next.updatedAt, seq: next.seq })
        .where(eq(containers.id, row.id))
        .run();
      this.db
        .update(worlds)
        .set({ pinnedEntityIds: next.pinnedEntityIds, theme: next.theme })
        .where(eq(worlds.id, row.id))
        .run();
      // Rename, pin reorder and a Theme edit all ride this one world-detail nudge — a theme edit bumps
      // `seq` so a live-following reader re-applies without a refresh (ADR-0076). Curation touches no
      // Entity's Rights, so the shared Entities are deliberately not fanned out.
      this.outbox.world(row.id);
      return next;
    });
  }

  /**
   * Delete a World and cascade its Entities, nudging each: every follower — of the World and of
   * each cascaded Entity — is shaped to `unavailable`. The Entity cascade joins this transaction,
   * so its buffered nudges flush only once the World row is gone too, never under a rollback.
   *
   * On-disk Asset bytes do not cascade; dropping them is the caller's, after the commit.
   */
  delete(id: string): void {
    this.transact(() => {
      this.entities.cascadeDeleteWorld(id);
      // The satellite cascades off the container id, and the Collaboration rows cascade off it.
      this.db.delete(containers).where(eq(containers.id, id)).run();
      this.outbox.world(id);
    });
  }

  /**
   * Apply a membership change through {@link MembershipWriter}, then — if it touched a row — bump
   * the World's `seq`, nudge its followers, and fan out to every `shared` Entity in it. Returns
   * whether anything changed, so a caller whose target was not a (removable) member can 404.
   *
   * It bumps **`seq` alone**: bumping `updatedAt` would send the World to the top of the World
   * Index's "recently updated" order merely because someone was added to it. `seq` is the freshness
   * key; `updatedAt` stays the domain-visible modified timestamp.
   *
   * Shaping is per recipient: a principal whose access ended resolves to `unavailable`, everyone
   * still-reachable to a detail nudge carrying their freshly-computed Rights.
   */
  membership(id: string, fn: (w: MembershipWriter) => void): boolean {
    return this.transact(() => {
      const { writer, changed } = this.membershipWriter(id);
      fn(writer);
      // A writer that matched nothing (an unknown user, an Owner the member path won't touch) left
      // the World as it found it: no bump, no nudge, no fan-out.
      if (!changed()) return false;
      this.db
        .update(containers)
        .set({ seq: sql`${containers.seq} + 1` })
        .where(eq(containers.id, id))
        .run();
      this.outbox.world(id);
      // The World's `shared` Entities confer Rights derived from this membership set, so they move
      // with it. See EntityWrites.bumpWorldShared for why emitting without a bump is a half-fix.
      this.entities.bumpWorldShared(id);
      return true;
    });
  }

  /**
   * Author a new user-defined type. Bumps `seq` alone, like {@link membership}. The service has
   * already checked the id is free, so the insert never conflicts.
   */
  createType(worldId: string, type: UserDefinedType, now: number = Date.now()): void {
    this.transact(() => {
      this.db
        .insert(worldTypes)
        .values({
          // The vocabulary hangs off the Container (ADR-0078); a World's Container id is its own id.
          containerId: worldId,
          typeId: type.id,
          label: type.label,
          fieldRefs: [...type.fieldRefs],
          views: type.views ? [...type.views] : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.bumpAndNudge(worldId);
    });
  }

  /**
   * Rename / re-Field a World's user-defined type. Returns whether a row matched — an unknown type
   * id leaves the World untouched, so the bump and nudge are skipped and the caller can 404.
   */
  updateType(
    worldId: string,
    typeId: string,
    patch: { label?: string; fieldRefs?: UserDefinedType['fieldRefs']; views?: UserDefinedType['views'] },
  ): boolean {
    return this.transact(() => {
      const updated = this.db
        .update(worldTypes)
        .set({
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.fieldRefs !== undefined ? { fieldRefs: [...patch.fieldRefs] } : {}),
          // A `fieldRefs` patch without `views` re-references a type that never named a view order: the
          // stored `null` stays, and the web defaults the order over the new Fields.
          ...(patch.views !== undefined ? { views: [...patch.views] } : {}),
          updatedAt: Date.now(),
        })
        .where(and(eq(worldTypes.containerId, worldId), eq(worldTypes.typeId, typeId)))
        .run();
      if (updated.changes === 0) return false;
      this.bumpAndNudge(worldId);
      return true;
    });
  }

  /** Delete a World's user-defined type. Returns whether a row matched, so an unknown id 404s. */
  deleteType(worldId: string, typeId: string): boolean {
    return this.transact(() => {
      const deleted = this.db
        .delete(worldTypes)
        .where(and(eq(worldTypes.containerId, worldId), eq(worldTypes.typeId, typeId)))
        .run();
      if (deleted.changes === 0) return false;
      this.bumpAndNudge(worldId);
      return true;
    });
  }

  /**
   * Author a new World-defined Field (ADR-0054). Bumps `seq` alone, like {@link createType}. The
   * service has already checked the id is free, so the insert never conflicts. The Field's body rides
   * in `definition` (id-less); `fieldId` is the `world.`-namespaced reuse handle.
   */
  createField(worldId: string, fieldId: string, definition: FieldSchema, now: number = Date.now()): void {
    this.transact(() => {
      this.db
        .insert(worldFields)
        .values({ containerId: worldId, fieldId, definition, createdAt: now, updatedAt: now })
        .run();
      this.bumpAndNudge(worldId);
    });
  }

  /**
   * Re-body a World-defined Field. Returns whether a row matched — an unknown id leaves the World
   * untouched, so the bump and nudge are skipped and the caller can 404. The id is immutable (ADR-0056):
   * a path param, never in the body, so no re-key path can orphan stored values.
   */
  updateField(worldId: string, fieldId: string, definition: FieldSchema): boolean {
    return this.transact(() => {
      const updated = this.db
        .update(worldFields)
        .set({ definition, updatedAt: Date.now() })
        .where(and(eq(worldFields.containerId, worldId), eq(worldFields.fieldId, fieldId)))
        .run();
      if (updated.changes === 0) return false;
      this.bumpAndNudge(worldId);
      return true;
    });
  }

  /**
   * Delete a World-defined Field. Returns whether a row matched, so an unknown id 404s. Entities
   * referencing it degrade to plain document values — the id simply stops resolving (ADR-0054).
   */
  deleteField(worldId: string, fieldId: string): boolean {
    return this.transact(() => {
      const deleted = this.db
        .delete(worldFields)
        .where(and(eq(worldFields.containerId, worldId), eq(worldFields.fieldId, fieldId)))
        .run();
      if (deleted.changes === 0) return false;
      this.bumpAndNudge(worldId);
      return true;
    });
  }

  /**
   * Declare one more **Mount** (ADR-0080), appended last. Returns whether a row landed: a Container
   * already mounted is the same Mount, so the conflict is ignored and nothing is announced.
   *
   * Bumps `seq` alone, like {@link membership} — a Mount is World configuration its followers must
   * refetch, not an edit that should send the World to the top of the Index. It fans out to nothing: a
   * Mount grants no Rights on *this* World's Entities.
   */
  mount(worldId: string, mountedContainerId: string): boolean {
    return this.transact(() => {
      const nextPosition = this.db
        .select({ next: sql<number>`coalesce(max(${containerMounts.position}), -1) + 1` })
        .from(containerMounts)
        .where(eq(containerMounts.containerId, worldId))
        .get();
      const inserted = this.db
        .insert(containerMounts)
        .values({ containerId: worldId, mountedContainerId, position: nextPosition?.next ?? 0 })
        .onConflictDoNothing()
        .run();
      if (inserted.changes === 0) return false;
      this.bumpAndNudge(worldId);
      return true;
    });
  }

  /** Drop one Mount, and nothing else. Returns whether a row matched, so unmounting nothing 404s. */
  unmount(worldId: string, mountedContainerId: string): boolean {
    return this.transact(() => {
      const deleted = this.db
        .delete(containerMounts)
        .where(
          and(eq(containerMounts.containerId, worldId), eq(containerMounts.mountedContainerId, mountedContainerId)),
        )
        .run();
      if (deleted.changes === 0) return false;
      this.bumpAndNudge(worldId);
      return true;
    });
  }

  /**
   * Rewrite the Mount order to `mountedContainerIds`, which the caller has already checked is a
   * permutation of what is mounted and actually different from it. Only `position` moves, so every
   * Mount survives as the same row.
   */
  reorderMounts(worldId: string, mountedContainerIds: readonly string[]): void {
    this.transact(() => {
      mountedContainerIds.forEach((mountedContainerId, position) => {
        this.db
          .update(containerMounts)
          .set({ position })
          .where(
            and(eq(containerMounts.containerId, worldId), eq(containerMounts.mountedContainerId, mountedContainerId)),
          )
          .run();
      });
      this.bumpAndNudge(worldId);
    });
  }

  /** Bump the World's `seq` and nudge its followers — the freshness half every type write shares. */
  private bumpAndNudge(worldId: string): void {
    this.db
      .update(containers)
      .set({ seq: sql`${containers.seq} + 1` })
      .where(eq(containers.id, worldId))
      .run();
    this.outbox.world(worldId);
  }

  /**
   * Drop every World membership a departing user holds — a **system write**, called when their
   * account is deleted. Bumps `seq` on each touched World, so a later nudge reads as newer than a
   * follower's held value, but **emits nothing**: the user's own sessions are dropped with the
   * account, and no surviving principal's standing on the World or its Entities changed.
   */
  purgeMembershipsOf(userId: string): void {
    this.transact(() => {
      const touched = this.db
        .select({ id: worldMembers.worldId })
        .from(worldMembers)
        .where(eq(worldMembers.userId, userId))
        .all()
        .map((r) => r.id);
      if (touched.length === 0) return;
      this.db.delete(worldMembers).where(eq(worldMembers.userId, userId)).run();
      this.db
        .update(containers)
        .set({ seq: sql`${containers.seq} + 1` })
        .where(inArray(containers.id, touched))
        .run();
    });
  }

  /**
   * The `world_members` write handle handed to a {@link membership} change, paired with the
   * "did anything change" predicate the caller gates its bump on. The flag is a closure, not a
   * property, so a destructured writer still reports its writes.
   */
  private membershipWriter(id: string): {
    writer: MembershipWriter;
    changed: () => boolean;
  } {
    const db = this.db;
    let changed = false;
    const target = (targetUserId: string) => and(eq(worldMembers.worldId, id), eq(worldMembers.userId, targetUserId));
    return {
      changed: () => changed,
      writer: {
        upsertOwner: (targetUserId) => {
          db.$client
            .prepare(
              `INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, 'owner')
               ON CONFLICT(world_id, user_id) DO UPDATE SET role = 'owner'`,
            )
            .run(id, targetUserId);
          changed = true;
        },
        upsertMember: (targetUserId, role) => {
          // `WHERE role != 'owner'` makes adding an existing Owner a no-op: a member role must
          // never overwrite ownership here — demoting an Owner belongs to the ownership-set
          // endpoints.
          db.$client
            .prepare(
              `INSERT INTO world_members (world_id, user_id, role) VALUES (?, ?, ?)
               ON CONFLICT(world_id, user_id) DO UPDATE SET role = excluded.role
               WHERE world_members.role != 'owner'`,
            )
            .run(id, targetUserId, role);
          changed = true;
        },
        setMemberRole: (targetUserId, role) => {
          const updated = db
            .update(worldMembers)
            .set({ role })
            .where(and(target(targetUserId), ne(worldMembers.role, 'owner')))
            .run();
          changed ||= updated.changes > 0;
        },
        removeMember: (targetUserId, allowOwner) => {
          const deleted = db
            .delete(worldMembers)
            .where(and(target(targetUserId), ...(allowOwner ? [] : [ne(worldMembers.role, 'owner')])))
            .run();
          changed ||= deleted.changes > 0;
        },
      },
    };
  }
}
