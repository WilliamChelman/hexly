import { Inject, Injectable } from '@nestjs/common';
import { InboundLinkCount, Mount } from '@hexly/domain';
import { and, asc, eq, isNotNull, notInArray, or } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { gate } from '../acl/owner-set';
import { worldAccess, worldOwnerFilter } from '../acl/world-access';
import { compendiums, containerMounts, containers, worlds } from '../db/schema';
import { ContainerLinksService } from './container-links.service';
import { WorldRouteRefusal, WorldRouteResult } from './world-route-result';
import { WorldWrites } from './world-writes';

/**
 * A World's **Mounts** (CONTEXT.md → Mount, ADR-0080): the Containers it declares it draws from, and
 * the add / reorder / unmount that maintain them. Member-gated to read and Owner-gated to arrange,
 * every route resolving its mounting Container through `worlds` so a **Compendium**'s id simply is not
 * one (ADR-0078). Deliberately not Collaboration-gated (ADR-0071).
 */
@Injectable()
export class WorldMountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly writes: WorldWrites,
    private readonly links: ContainerLinksService,
  ) {}

  /**
   * The World's Mounts in the Owner-arranged order — the one route here that is not Owner-gated, since
   * this is what the **Library** reads (#412). Member-gated rather than reachable-gated, because the
   * cascade is deliberately one hop (ADR-0080): a reader who reaches *this* World through someone
   * else's Mount cannot read what it in turn draws from, so naming those Containers to them would
   * disclose the second hop the cascade withholds. Reachable-but-not-a-member → 403, unreachable → 404.
   */
  list(userId: string, worldId: string): WorldRouteResult<Mount[]> {
    const meta = worldAccess(this.db, userId).decideMeta(worldId);
    if (!meta?.reachable) return { status: 'not-found' };
    if (!meta.isMember) return { status: 'forbidden' };
    return { status: 'ok', value: this.mounts(worldId) };
  }

  /**
   * The Containers the caller may mount into this World: every installed Compendium plus every World
   * they personally Own, minus this World itself and minus what is already mounted. A Container they
   * merely read is never among them — that is the Own-only rule, offered rather than only enforced.
   */
  candidates(userId: string, worldId: string): WorldRouteResult<Mount[]> {
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
  add(userId: string, worldId: string, containerId: string): WorldRouteResult<Mount[]> {
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
  reorder(userId: string, worldId: string, containerIds: readonly string[]): WorldRouteResult<Mount[]> {
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

  /**
   * What dropping this Mount would break: how many links from *this* World point into that Container
   * (ADR-0080, #414). Read per act, so the panel asks the moment it offers the unmount and never
   * caches an answer that a co-author's next save would make wrong.
   *
   * Owner-gated like the rest of the surface and nothing more — the Mount need not exist for the
   * question to have an answer, and `remove` is the one that decides whether it is there to drop. The
   * answer never refuses the unmount: it is a number and a confirm.
   */
  linkCount(userId: string, worldId: string, containerId: string): WorldRouteResult<InboundLinkCount> {
    const gate = this.gateOwner(userId, worldId);
    return gate ?? { status: 'ok', value: this.links.countInbound(containerId, worldId) };
  }

  /** Drop one Mount and nothing else. Unmounting what is not mounted is a 404, never a silent success. */
  remove(userId: string, worldId: string, containerId: string): WorldRouteResult<Mount[]> {
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
  private gateOwner(userId: string, worldId: string): WorldRouteRefusal | undefined {
    return gate(worldAccess(this.db, userId).decideMeta(worldId) ?? { reachable: false, isOwner: false });
  }

  /** The mounted side's gate: the Own-only rule, with the Compendium exception. */
  private gateMountable(userId: string, worldId: string, containerId: string): WorldRouteRefusal | undefined {
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
