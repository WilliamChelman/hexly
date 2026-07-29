import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CompendiumSummary } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { DB, Db } from '../db/db';
import { compendiumById, listCompendiums } from './compendiums';

/**
 * The installed packs (CONTEXT.md → Compendium), Instance-wide and outside the World scope — a
 * Compendium is not in a World, and the route says so.
 *
 * The guard sits per route rather than on the class, because the two reads no longer answer the same
 * question. Listing the shelf is session-guarded, and that *is* the Compendium's access rule:
 * Instance-wide with no members, no roles and no public link (ADR-0078), so there is nothing per-caller
 * to resolve, and the same answer for every signed-in caller is what makes the shelf a shelf.
 *
 * The Compendium browse names its Containers from that list rather than riding single-Container
 * scoping, because the read is *about* compendium content (ADR-0079). Each row also carries the pack's
 * pinned `rev` and its attribution, which is where a pack's own page reads its terms from (#402).
 */
@Controller('compendiums')
export class CompendiumsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  list(): CompendiumSummary[] {
    return listCompendiums(this.db);
  }

  /**
   * One installed pack, for the **Compendium page** (ADR-0061, #402). A World's id is a 404 here: the
   * satellite is the discriminator (ADR-0078), so no Collaboration rule is ever consulted.
   *
   * Unguarded, alone on this controller: a **Mount** cascades read to anonymous World Public Link
   * holders, and a pack's terms must never sit behind a wall its content does not (ADR-0080). The
   * standing is the pack's unguessable Container id, as it is on the asset byte route.
   */
  @Get(':id')
  get(@Param('id') id: string): CompendiumSummary {
    const compendium = compendiumById(this.db, id);
    if (!compendium) throw new NotFoundException('Compendium not found');
    return compendium;
  }
}
