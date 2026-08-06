import { Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CompendiumPackSummary, ImportRunSummary, InboundLinkCount } from '@hexly/domain';
import { SuperadminGuard } from '../admin/manage-users.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ImportReconcileService } from './import-reconcile.service';

/**
 * The operator's compendium pack surface (ADR-0079): installing, reimporting and removing the packs a
 * **Compendium** is stocked from. Superadmin-gated and mounted under `/admin` because a pack is
 * Instance-wide, on ADR-0052's footing. Nothing here names a World or takes a Visibility; the
 * reconcile behind it is the World surface's own (ADR-0060).
 */
@Controller('admin/compendiums')
@UseGuards(SessionAuthGuard, SuperadminGuard)
export class CompendiumPacksController {
  constructor(private readonly imports: ImportReconcileService) {}

  /**
   * Every pack the enabled Plugins offer, with what is installed, at which revision, and where its run
   * stands. The panel's list and its poll target both — a pack's run is the only thing that moves.
   */
  @Get()
  list(): CompendiumPackSummary[] {
    return this.imports.packs();
  }

  /**
   * Install (or reimport) a pack, returning at once (202) — the reconcile outlives the request; follow
   * it by re-reading {@link list}. A run already in flight for this pack is a 409 (raised in the
   * service); an Importer that is not a pack, or none at all, is a 404.
   */
  @Post(':importerId/run')
  @HttpCode(202)
  run(@CurrentUser() user: AuthUser, @Param('importerId') importerId: string): ImportRunSummary {
    const result = this.imports.installPack(user.id, importerId);
    if (result === 'no-such-importer') throw new NotFoundException();
    return result;
  }

  /**
   * What removing this pack would break in the Worlds drawing on it (ADR-0080, #414): the links
   * pointing into its Compendium, and how many Containers they come from. A GET beside the DELETE,
   * read per act, and advisory — the removal below never consults it.
   */
  @Get(':importerId/inbound-links')
  inboundLinks(@Param('importerId') importerId: string): InboundLinkCount {
    const result = this.imports.packInboundLinks(importerId);
    if (result === 'no-such-importer') throw new NotFoundException();
    return result;
  }

  /** Remove a pack: its entries go, its Container goes, and every adopted copy stays (ADR-0079). */
  @Delete(':importerId')
  @HttpCode(204)
  async remove(@Param('importerId') importerId: string): Promise<void> {
    if ((await this.imports.removePack(importerId)) === 'no-such-importer') throw new NotFoundException();
  }
}
