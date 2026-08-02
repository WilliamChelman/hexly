import { SQL, SQLWrapper, sql } from 'drizzle-orm';
import { compendiums, containerMounts, worldMembers } from '../db/schema';

/**
 * The **Mount** cascade (ADR-0080): the Container at `containerRef` is Mounted by a World the
 * `mounting` predicate admits, and that Mount still satisfies the Own-only rule.
 *
 * `<ref> IN (SELECT …)` rather than a correlated `EXISTS`, so the caller's reference stays outside
 * every subquery: drizzle strips table qualifiers in places (see `world-access.ts`), and a bare
 * `container_id` inside `EXISTS (… FROM container_mounts …)` would bind to the mount row's own column.
 */
function mountedBy(mounting: SQL, containerRef: SQLWrapper): SQL {
  return sql`${containerRef} IN (SELECT ${containerMounts.mountedContainerId} FROM ${containerMounts} WHERE ${mounting} AND ${stillOwned()})`;
}

/**
 * The Own-only rule (ADR-0080) asked on every read rather than at declaration alone: some Owner of the
 * mounting World must still Own the mounted Container. Enforced once at write time it does not hold —
 * a co-Owner may evict the Owner who declared the Mount (ADR-0037), leaving her shelf cascading into a
 * World she is now a stranger to, with no route left to withdraw it. A **Compendium** is Instance-wide
 * with no members and mounting one grants nothing (ADR-0079), so it is exempt.
 *
 * Correlated to `container_mounts`, so it also serves a WHERE over that table directly — which is how the
 * **link-target read**'s Mount scope asks the same rule rather than keeping a second copy of it.
 *
 * Both `EXISTS` bodies correlate to `container_mounts` by column name alone, which resolves to the same
 * row qualified or stripped — neither table shares a column name with it.
 */
export function stillOwned(): SQL {
  return sql`(EXISTS (SELECT 1 FROM ${compendiums} WHERE ${compendiums.id} = ${containerMounts.mountedContainerId})
    OR EXISTS (SELECT 1 FROM ${worldMembers}
               WHERE ${worldMembers.worldId} = ${containerMounts.containerId} AND ${worldMembers.role} = 'owner'
                 AND ${worldMembers.userId} IN (SELECT ${worldMembers.userId} FROM ${worldMembers}
                                                WHERE ${worldMembers.worldId} = ${containerMounts.mountedContainerId}
                                                  AND ${worldMembers.role} = 'owner')))`;
}

/**
 * `containerRef` is Mounted by a World the caller is a member of — the third disjunct reachability
 * grows, and the whole of what a Mount confers on a reader.
 *
 * Exactly one hop: the mounting side is a membership row, never reachability again, so Mounts do not
 * chain and a cycle is harmless. Membership rather than reachability because a caller who reaches a
 * World only by an Entity grant inside it cannot read that World's own `shared` content either.
 */
export function mountedIntoReachOf(userId: string, containerRef: SQLWrapper): SQL {
  const mounting = sql`${containerMounts.containerId} IN (SELECT ${worldMembers.worldId} FROM ${worldMembers} WHERE ${worldMembers.userId} = ${userId})`;
  return mountedBy(mounting, containerRef);
}

/** `containerRef` is Mounted by the World at `worldRef` — the form a **World Public Link** rides, its token naming the World outright. */
export function mountedIntoWorld(worldRef: SQLWrapper, containerRef: SQLWrapper): SQL {
  return mountedBy(sql`${containerMounts.containerId} = ${worldRef}`, containerRef);
}
