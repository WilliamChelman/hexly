import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CompendiumSummary } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { DB, Db } from '../db/db';
import { compendiumById, listCompendiums } from './compendiums';

/**
 * The installed packs (CONTEXT.md → Compendium), Instance-wide and outside the World scope — a
 * Compendium is not in a World, and the route says so.
 *
 * Session-guarded, both reads, and that *is* the Compendium's access rule: Instance-wide with no
 * members, no roles and no public link (ADR-0078), so there is nothing per-caller to resolve and being
 * on this Instance is the whole standing. ADR-0034's possession-is-the-token is content-addressed bytes
 * on a static route and stops there, so the pack's Container id is an identifier here, not a credential.
 * The account-less reader a **Mount** cascaded read to reaches a pack's terms by naming the World
 * Public Link that carries them, at `GET /public/worlds/:token/compendiums/:id` (ADR-0080, #410).
 *
 * Each row carries the pack's pinned `rev` and its attribution, which is where a pack's own page reads
 * its terms from (#402). The list itself is the operator's view of the shelf: a **Library** names its
 * Containers from the World's **Mounts**, not from what happens to be installed (ADR-0080).
 */
@Controller('compendiums')
@UseGuards(SessionAuthGuard)
export class CompendiumsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(): CompendiumSummary[] {
    return listCompendiums(this.db);
  }

  /**
   * One installed pack, for the **Compendium page** (ADR-0061, #402). A World's id is a 404 here: the
   * satellite is the discriminator (ADR-0078), so no Collaboration rule is ever consulted.
   */
  @Get(':id')
  get(@Param('id') id: string): CompendiumSummary {
    const compendium = compendiumById(this.db, id);
    if (!compendium) throw new NotFoundException('Compendium not found');
    return compendium;
  }
}
