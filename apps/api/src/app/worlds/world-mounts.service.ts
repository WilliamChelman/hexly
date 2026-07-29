import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Mount, MountCandidate } from '@hexly/domain';
import { and, asc, eq, isNotNull, notInArray, or } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { gate } from '../acl/owner-set';
import { worldAccess, worldOwnerFilter } from '../acl/world-access';
import { compendiums, containerMounts, containers, worlds } from '../db/schema';
import { WorldWrites } from './world-writes';

/**
 * The outcome of a Mount operation, mapped to HTTP by {@link mountResponse}: `not-found` = no such
 * World, or one the caller can't reach (404, ADR-0004 — existence never leaks); `forbidden` =
 * reachable but the caller may not do this (403); `invalid` = a reorder that is not a reorder (400).
 */
export type MountResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'invalid' };

/** The refusal arms alone — what a gate returns, and what {@link gate} already produces. */
type MountRefusal = Extract<MountResult<never>, { status: 'not-found' | 'forbidden' }>;

/** Map a {@link MountResult} to its HTTP outcome: `ok` unwraps, else the status's exception. */
export function mountResponse<T>(result: MountResult<T>): T {
  switch (result.status) {
    case 'ok':
      return result.value;
    case 'not-found':
      throw new NotFoundException();
    case 'forbidden':
      throw new ForbiddenException();
    case 'invalid':
      throw new BadRequestException();
  }
}

/**
 * A World's **Mounts** (CONTEXT.md → Mount, ADR-0080): the Containers it declares it draws from, and
 * the add / reorder / unmount that maintain them.
 *
 * Ownership on the mounted side is *personal* — {@link worldOwnerFilter} carries no Superadmin bypass
 * — because the Own-only rule exists so a Mount can only republish content the caller already
 * controls. A **Compendium** is exempt: Instance-wide and already readable by every signed-in caller,
 * so mounting one grants nothing (ADR-0079).
 *
 * Every route resolves its *mounting* Container through `worlds`, which is the whole of "a Compendium
 * may not mount": a pack's id is not a World here, so it 404s with no rule naming the case. Arranging
 * Mounts is World-Owner-gated like `/owners` and `/members`; {@link list} alone answers any reader,
 * for the **Library**. Deliberately not Collaboration-gated throughout (ADR-0071).
 */
@Injectable()
export class WorldMountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly writes: WorldWrites,
  ) {}

  /**
   * The World's Mounts in the Owner-arranged order. The one route here that is *not* Owner-gated: any
   * reader of the World gets it, because this is what the **Library** reads (ADR-0080) and the Mount
   * cascade has already handed those readers the content itself — naming the Containers it came out of
   * discloses nothing they cannot open. Arranging the list stays the Owner's. Unreachable → 404.
   */
  list(userId: string, worldId: string): MountResult<Mount[]> {
    const meta = worldAccess(this.db, userId).decideMeta(worldId);
    if (!meta?.reachable) return { status: 'not-found' };
    return { status: 'ok', value: this.mounts(worldId) };
  }

  /**
   * The Containers the caller may mount into this World: every installed Compendium plus every World
   * they personally Own, minus this World itself and minus what is already mounted. A Container they
   * merely read is never among them — that is the Own-only rule, offered rather than only enforced.
   */
  candidates(userId: string, worldId: string): MountResult<MountCandidate[]> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    const taken = [worldId, ...this.mounts(worldId).map((m) => m.containerId)];
    const rows = this.db
      .select({ containerId: containers.id, name: containers.name, kind: containers.kind })
      .from(containers)
      // The satellite each kind completes its row with is the discriminator (ADR-0078), so "a World I
      // own" and "an installed pack" are two joins rather than a `kind` filter.
      .leftJoin(worlds, eq(worlds.id, containers.id))
      .leftJoin(compendiums, eq(compendiums.id, containers.id))
      .where(
        and(
          or(and(isNotNull(worlds.id), worldOwnerFilter(userId)), isNotNull(compendiums.id)),
          notInArray(containers.id, taken),
        ),
      )
      // By name: the Owner picks by the name the thing carries, not by when it was made.
      .orderBy(asc(containers.name), asc(containers.id))
      .all();
    return { status: 'ok', value: rows };
  }

  /**
   * Declare one more Container this World draws from, appended last. Idempotent: a Container already
   * mounted is the same Mount, so re-adding returns the list unchanged rather than a second row.
   *
   * Refusals split on what the caller can already see: a Container they can reach but do not Own is a
   * 403 (they know it exists), one they cannot reach at all is a 404 (ADR-0004). A World may not mount
   * itself — it already holds its own Entities, and "the Container or one it Mounts" would be a
   * tautology.
   */
  add(userId: string, worldId: string, containerId: string): MountResult<Mount[]> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    const mountable = this.gateMountable(userId, worldId, containerId);
    if (mountable) return mountable;
    this.writes.mount(worldId, containerId);
    return { status: 'ok', value: this.mounts(worldId) };
  }

  /**
   * Rewrite the Mount order wholesale, as the Dashboard pins are (ADR-0043). Anything that is not a
   * permutation of what is mounted is a 400 — `reorderMountsRequestSchema` says why that refusal is
   * load-bearing.
   */
  reorder(userId: string, worldId: string, containerIds: readonly string[]): MountResult<Mount[]> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    const current = this.mounts(worldId);
    const mounted = new Set(current.map((m) => m.containerId));
    if (containerIds.length !== mounted.size || !containerIds.every((id) => mounted.has(id))) {
      return { status: 'invalid' };
    }
    // An order that is already the order changed nothing, so it announces nothing — the same restraint
    // re-declaring a Mount shows.
    if (current.every((m, i) => m.containerId === containerIds[i])) return { status: 'ok', value: current };
    this.writes.reorderMounts(worldId, containerIds);
    return { status: 'ok', value: this.mounts(worldId) };
  }

  /** Drop one Mount and nothing else. Unmounting what is not mounted is a 404, never a silent success. */
  remove(userId: string, worldId: string, containerId: string): MountResult<Mount[]> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    if (!this.writes.unmount(worldId, containerId)) return { status: 'not-found' };
    return { status: 'ok', value: this.mounts(worldId) };
  }

  /** The stored Mounts, ordered. Unguarded — every entry point above has already gated the World. */
  private mounts(worldId: string): Mount[] {
    return this.db
      .select({ containerId: containers.id, name: containers.name, kind: containers.kind })
      .from(containerMounts)
      .innerJoin(containers, eq(containers.id, containerMounts.mountedContainerId))
      .where(eq(containerMounts.containerId, worldId))
      .orderBy(asc(containerMounts.position), asc(containers.id))
      .all();
  }

  /**
   * The mounting side's gate — the shared owner-management gate (ADR-0037), which a Compendium's id
   * never reaches: `decideMeta` reads the `worlds` satellite, so a pack resolves to no row.
   */
  private gateOwner(userId: string, worldId: string): MountRefusal | undefined {
    return gate(worldAccess(this.db, userId).decideMeta(worldId) ?? { reachable: false, isOwner: false });
  }

  /** The mounted side's gate: the Own-only rule, with the Compendium exception. */
  private gateMountable(userId: string, worldId: string, containerId: string): MountRefusal | undefined {
    if (containerId === worldId) return { status: 'forbidden' };
    const compendium = this.db
      .select({ id: compendiums.id })
      .from(compendiums)
      .where(eq(compendiums.id, containerId))
      .get();
    if (compendium) return undefined;
    const owned = this.db
      .select({ id: worlds.id })
      .from(worlds)
      .where(and(eq(worlds.id, containerId), worldOwnerFilter(userId)))
      .get();
    if (owned) return undefined;
    // Not ownable by them. Reachable is a 403 (they can see it exists); anything else is a 404.
    const meta = worldAccess(this.db, userId).decideMeta(containerId);
    return meta?.reachable ? { status: 'forbidden' } : { status: 'not-found' };
  }
}
