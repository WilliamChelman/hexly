import { Inject, Injectable } from '@nestjs/common';
import { CompendiumSummary, EntityDetail, PublicWorldView } from '@hexly/domain';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { containerMounts, containers, worldLinks, worlds } from '../db/schema';
import { EntitiesService } from '../entities/entities.service';
import { compendiumById } from '../worlds/compendiums';

/**
 * The unauthenticated, read-only surface for Public Links (ADR-0037): a token resolves to exactly
 * its scope. A per-entity link yields one Entity (piercing `private` — the token is an anonymous
 * Viewer grant); a World link yields only that World's `shared` Entities. A revoked (or
 * never-minted) token resolves to null → 404.
 */
@Injectable()
export class PublicLinksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly entities: EntitiesService,
  ) {}

  /** The Entity behind a per-entity Public Link, read-only (pierces `private`), or null. */
  readEntity(token: string): EntityDetail | null {
    return this.entities.loadByEntityLink(token);
  }

  /**
   * The World behind a World Public Link: its identity plus its `shared` Entity summaries, or null
   * if the token doesn't resolve (revoked/never minted). A reader opens any listed Entity through
   * {@link readWorldEntity}.
   */
  readWorld(token: string): PublicWorldView | null {
    const world = this.db
      .select({ id: containers.id, name: containers.name, theme: worlds.theme })
      .from(worldLinks)
      .innerJoin(worlds, eq(worlds.id, worldLinks.worldId))
      .innerJoin(containers, eq(containers.id, worlds.id))
      .where(eq(worldLinks.id, token))
      .get();
    if (!world) return null;
    return {
      worldId: world.id,
      worldName: world.name,
      // The anonymous visitor has no account to resolve a Theme through, so it rides the view (ADR-0076).
      ...(world.theme ? { theme: world.theme } : {}),
      entities: this.entities.listSharedByWorld(world.id),
    };
  }

  /**
   * One Entity's read-only body behind a World Public Link — the token's World's `shared` surface plus
   * what its **Mounts** republish (ADR-0080), so a Board's shelf art and a mounted pack's entries open
   * to the account-less reader the session was shared with. A `private` Entity, or one in neither the
   * World nor a Mount, yields null (→ 404).
   */
  readWorldEntity(token: string, id: string): EntityDetail | null {
    const worldId = this.resolveWorldToken(token);
    if (!worldId) return null;
    return this.entities.loadThroughWorldLink(worldId, id);
  }

  /**
   * The terms one mounted **Compendium** is published under, for the account-less reader the cascade
   * reached (ADR-0061, ADR-0080, #410): a pack's terms must never sit behind a wall its content does
   * not, and the token's World is what says which packs those are. A Container the token's World does
   * not Mount — or one that is no pack at all — yields null (→ 404), so the id is an identifier here
   * rather than a credential.
   */
  readCompendium(token: string, id: string): CompendiumSummary | null {
    const worldId = this.resolveWorldToken(token);
    if (!worldId) return null;
    const mounted = this.db
      .select({ id: containerMounts.mountedContainerId })
      .from(containerMounts)
      .where(and(eq(containerMounts.containerId, worldId), eq(containerMounts.mountedContainerId, id)))
      .get();
    return mounted ? (compendiumById(this.db, id) ?? null) : null;
  }

  /** A World Public Link token → its World id, or null if the token doesn't resolve. */
  private resolveWorldToken(token: string): string | null {
    const link = this.db.select({ worldId: worldLinks.worldId }).from(worldLinks).where(eq(worldLinks.id, token)).get();
    return link?.worldId ?? null;
  }
}
