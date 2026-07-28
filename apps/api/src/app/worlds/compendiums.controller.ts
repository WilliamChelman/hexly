import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CompendiumSummary } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { DB, Db } from '../db/db';
import { compendiumById, listCompendiums } from './compendiums';

/**
 * The installed packs (CONTEXT.md → Compendium), Instance-wide and outside the World scope — a
 * Compendium is not in a World, and the route says so.
 *
 * Session-guarded and nothing more. That *is* the Compendium's access rule: Instance-wide with no
 * members, no roles and no public link (ADR-0078), so there is nothing per-caller to resolve, and the
 * same answer for every signed-in caller is what makes the shelf a shelf. It is the reachability rule
 * the entries themselves follow, one level up.
 *
 * The Compendium browse names its Containers from this list rather than riding single-Container
 * scoping, because the read is *about* compendium content (ADR-0079). Each row also carries the pack's
 * pinned `rev` and its attribution, which is where a pack's own page reads its terms from (#402).
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
   * One pack, for its own page (#402): the terms its content is published under, stated where that
   * content is read rather than in a `NOTICE.md` the reader never opens (ADR-0061). A World's id is a
   * 404 here — the satellite is the discriminator, so no Collaboration rule is ever consulted.
   */
  @Get(':id')
  get(@Param('id') id: string): CompendiumSummary {
    const compendium = compendiumById(this.db, id);
    if (!compendium) throw new NotFoundException('Compendium not found');
    return compendium;
  }
}
