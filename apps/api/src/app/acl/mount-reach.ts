import { SQL, SQLWrapper, sql } from 'drizzle-orm';
import { containerMounts, worldMembers } from '../db/schema';

/**
 * The **Mount** cascade (ADR-0080): the Container at `containerRef` is Mounted by a World the
 * `mounting` predicate admits.
 *
 * `<ref> IN (SELECT …)` rather than a correlated `EXISTS`, so the caller's reference stays outside
 * every subquery: drizzle strips table qualifiers in places (see `world-access.ts`), and a bare
 * `container_id` inside `EXISTS (… FROM container_mounts …)` would bind to the mount row's own column.
 */
function mountedBy(mounting: SQL, containerRef: SQLWrapper): SQL {
  return sql`${containerRef} IN (SELECT ${containerMounts.mountedContainerId} FROM ${containerMounts} WHERE ${mounting})`;
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
