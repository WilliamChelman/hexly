import { Inject, Injectable } from '@nestjs/common';
import { EntityDetail, PublicWorldView } from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { worldLinks, worlds } from '../db/schema';
import { EntitiesService } from '../entities/entities.service';

/**
 * The unauthenticated read surface for Public Links (ADR-0037, #162): resolves a shared
 * token to exactly its scope and nothing more. A per-entity link yields one Entity
 * (piercing `private`, since the token is an anonymous Viewer grant); a World link yields
 * only that World's `shared` Entities. Every method is strictly read-only — the whole
 * `/public` surface exposes GET routes only, so possession of a URL grants nothing beyond
 * its scope. A revoked (or never-minted) token resolves to null → 404.
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
   * The World behind a World Public Link: its identity plus its `shared` Entity summaries,
   * or null if the token doesn't resolve (revoked/never minted). The Home Entity (always
   * `shared`) is listed among the shared Entities as the landing page; a reader opens any
   * listed Entity through {@link readWorldEntity}. Token → World identity is one join.
   */
  readWorld(token: string): PublicWorldView | null {
    const world = this.db
      .select({ id: worlds.id, name: worlds.name })
      .from(worldLinks)
      .innerJoin(worlds, eq(worlds.id, worldLinks.worldId))
      .where(eq(worldLinks.id, token))
      .get();
    if (!world) return null;
    return {
      worldId: world.id,
      worldName: world.name,
      entities: this.entities.listSharedByWorld(world.id),
    };
  }

  /**
   * One `shared` Entity's read-only body behind a World Public Link — scoped to the token's
   * World *and* `shared`, so the link reaches that World's shared surface and nothing else.
   * null (→ 404) for a `private` or out-of-World id: the reader renders a dangling label.
   */
  readWorldEntity(token: string, id: string): EntityDetail | null {
    const worldId = this.resolveWorldToken(token);
    if (!worldId) return null;
    return this.entities.loadSharedInWorld(worldId, id);
  }

  /** A World Public Link token → its World id, or null if the token doesn't resolve. */
  private resolveWorldToken(token: string): string | null {
    const link = this.db
      .select({ worldId: worldLinks.worldId })
      .from(worldLinks)
      .where(eq(worldLinks.id, token))
      .get();
    return link?.worldId ?? null;
  }
}
