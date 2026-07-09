import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MemberRole } from '@hexly/domain';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { INITIAL_SEQ, worldMembers, worlds } from '../db/schema';
import { SyncOnly, WriteOutbox } from '../events/write-outbox';
import { EntityWrites } from '../entities/entity-writes';

/** A stored `worlds` row. */
export type WorldRow = typeof worlds.$inferSelect;

/**
 * The narrow handle a membership change writes `world_members` rows through — the World peer of
 * `EntityWrites`'s `AclWriter`. It exists so the *invariants* (≥1-Owner, no-such-user, owner-wins
 * upsert) can stay in the service that reads best with them, while the write itself stays inside
 * {@link WorldWrites}, which is what makes the bump-and-nudge structural rather than a convention.
 * Runs inside the transaction, before the `seq` bump.
 *
 * A writer that matched no row leaves the World untouched, and {@link WorldWrites.membership}
 * then skips the bump and the nudge — a no-op write must not tell followers to refetch — and
 * reports `false`, which is the `not-found` every matchless caller already returns.
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
 * The single write handle for `worlds` and `world_members` — the World peer of `EntityWrites`
 * (ADR-0045). It owns the `seq` bump, the post-commit emit, and the fan-out to the World's shared
 * Entities, so a write *cannot* land without nudging its followers. An ESLint rule bans
 * `insert|update|delete(worlds)` and `insert|update|delete(worldMembers)` everywhere else.
 *
 * The fan-out is the reason this module exists rather than a convention on the service. A World
 * membership change moves Rights on two resources at once — the World, and every `shared` Entity
 * in it (`canRead` = `… ∨ (shared ∧ world-member)`, `canWrite` = `… ∨ (shared ∧ world-owner)`).
 * `bumpAndNudge` did only the first, so promoting a member to World Owner left them live-following
 * a shared Entity with a read-only `rights` array and no Save button: the same "Rights never
 * refreshed" defect ADR-0045 made unstatable for entity grants, surviving on the World path
 * because nothing structural forced the second half.
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
   * Insert an empty World and its creator's `owner` membership together, so a new World is never
   * ownerless. Returns the new World id. No nudge: nothing can be following an id that did not
   * exist a moment ago.
   */
  mint(ownerId: string, name: string, now: number = Date.now()): string {
    const id = randomUUID();
    return this.transact(() => {
      this.db.insert(worlds).values({ id, name, createdAt: now, updatedAt: now }).run();
      this.db.insert(worldMembers).values({ worldId: id, userId: ownerId, role: 'owner' }).run();
      return id;
    });
  }

  /**
   * Write a World's Owner-curated fields — `name` and/or the ordered `pinnedEntityIds`. A rename
   * or a pin reorder *is* a modification, so both timestamps move, unlike {@link membership} which
   * moves `seq` alone. An absent field is left untouched.
   *
   * The post-write `seq` is computed once, in JS, and used for both the SET and the returned row:
   * the caller's own write-through then advances its held freshness to exactly what the row holds,
   * so the server's echo nudge for this very write dedups to nothing. Safe because `better-sqlite3`
   * is synchronous and the read rode the same transaction.
   */
  update(row: WorldRow, patch: { name?: string; pinnedEntityIds?: string[] }): WorldRow {
    const next: WorldRow = {
      ...row,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.pinnedEntityIds !== undefined
        ? { pinnedEntityIds: patch.pinnedEntityIds }
        : {}),
      updatedAt: Date.now(),
      seq: row.seq + 1,
    };
    return this.transact(() => {
      this.db
        .update(worlds)
        .set({
          name: next.name,
          pinnedEntityIds: next.pinnedEntityIds,
          updatedAt: next.updatedAt,
          seq: next.seq,
        })
        .where(eq(worlds.id, row.id))
        .run();
      // Rename and pin reorder both ride this one world-detail nudge. Curation touches no Entity's
      // Rights, so the shared Entities are deliberately not fanned out.
      this.outbox.world(row.id);
      return next;
    });
  }

  /**
   * Delete a World and cascade its Entities, nudging each. Deletion is eviction: the rows are gone,
   * so the bus shapes every follower — of the World and of each cascaded Entity — to `unavailable`.
   * The Entity cascade joins this transaction, so its buffered nudges flush only once the World row
   * is gone too, never under a rollback.
   *
   * On-disk Asset bytes do not cascade; dropping them is the caller's, after the commit.
   */
  delete(id: string): void {
    this.transact(() => {
      this.entities.cascadeDeleteWorld(id);
      this.db.delete(worlds).where(eq(worlds.id, id)).run();
      this.outbox.world(id);
    });
  }

  /**
   * Apply a membership change through {@link MembershipWriter}, then — if it touched a row — bump
   * the World's `seq`, nudge its followers, and fan out to every `shared` Entity in it. Returns
   * whether anything changed, so a caller whose target was not a (removable) member can 404.
   *
   * It bumps **`seq` alone** on the World: a membership mutation touches neither `name` nor pins,
   * so bumping `updatedAt` would send the World to the top of the World Index's "recently updated"
   * order merely because someone was added to it. `seq` is the freshness key; `updatedAt` stays the
   * domain-visible modified timestamp.
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
        .update(worlds)
        .set({ seq: sql`${worlds.seq} + 1` })
        .where(eq(worlds.id, id))
        .run();
      this.outbox.world(id);
      // The World's `shared` Entities confer Rights derived from this membership set, so they move
      // with it. See EntityWrites.bumpWorldShared for why emitting without a bump is a half-fix.
      this.entities.bumpWorldShared(id);
      return true;
    });
  }

  /**
   * Drop every World membership a departing user holds — a **system write**, called when their
   * account is deleted. It bumps `seq` on each touched World, because the World's membership set
   * moved and a later nudge must read as newer than a follower's held value, but deliberately
   * **emits nothing**: the user's own sessions are dropped with the account, so they self-evict,
   * and no surviving principal's standing on the World or its Entities changed.
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
        .update(worlds)
        .set({ seq: sql`${worlds.seq} + 1` })
        .where(inArray(worlds.id, touched))
        .run();
    });
  }

  /**
   * The `world_members` write handle handed to a {@link membership} change, paired with the
   * "did anything actually change" predicate the caller gates its bump on. The flag is a closure,
   * not a property, so a destructured writer still reports its writes.
   */
  private membershipWriter(id: string): {
    writer: MembershipWriter;
    changed: () => boolean;
  } {
    const db = this.db;
    let changed = false;
    const target = (targetUserId: string) =>
      and(eq(worldMembers.worldId, id), eq(worldMembers.userId, targetUserId));
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
            .where(
              and(target(targetUserId), ...(allowOwner ? [] : [ne(worldMembers.role, 'owner')])),
            )
            .run();
          changed ||= deleted.changes > 0;
        },
      },
    };
  }
}
