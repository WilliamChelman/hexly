import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, ImporterSummary, ImportRunSummary } from '@hexly/domain';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ImportRefusal, ImportReconcileService } from './import-reconcile.service';

/**
 * The per-World import surface (ADR-0060) — the generic, importer-agnostic feature mounted under the
 * World the way vault import hangs off the Worlds surface. Every route is Owner-gated in the service
 * (unreachable World ≡ 404, reachable-but-not-Owner ≡ 403), so a non-Owner never reaches an Importer.
 * The controller is importer-agnostic: it lists whatever Importers the enabled Plugins registered, and
 * runs / polls / removes them through the one reconcile.
 *
 * A **Compendium Importer** is not among them (ADR-0079): a pack is Instance-wide, so stocking one is
 * the operator's job and lives in {@link CompendiumPacksController}. This surface neither lists nor
 * runs one — an attempt is a 404, the same answer as for an Importer no Plugin registered.
 */
@Controller('worlds/:worldId')
@UseGuards(SessionAuthGuard)
export class WorldImportersController {
  constructor(private readonly imports: ImportReconcileService) {}

  /** The Importers available for this World. */
  @Get('importers')
  list(@CurrentUser() user: AuthUser, @Param('worldId') worldId: string): ImporterSummary[] {
    return this.unwrap(this.imports.list(user.id, worldId));
  }

  /**
   * Run (or reimport) an Importer into this World, and return at once (202) — the reconcile outlives
   * the request; poll {@link status}. A second run while one is in flight is a 409 (raised in the
   * service). An unknown Importer is a 404. No body: the run has nothing left to choose (ADR-0079).
   */
  @Post('importers/:importerId/run')
  @HttpCode(202)
  run(
    @CurrentUser() user: AuthUser,
    @Param('worldId') worldId: string,
    @Param('importerId') importerId: string,
  ): ImportRunSummary {
    return this.unwrap(this.imports.start(user.id, worldId, importerId));
  }

  /** Where this World's import run stands — the poll target for a running reconcile, plus the last finished run. */
  @Get('import/status')
  status(@CurrentUser() user: AuthUser, @Param('worldId') worldId: string): ImportRunSummary {
    return this.unwrap(this.imports.status(user.id, worldId));
  }

  /** Remove an Importer's whole set from this World (no recreate). Hand-authored Entities are left intact. */
  @Delete('importers/:importerId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('worldId') worldId: string,
    @Param('importerId') importerId: string,
  ): Promise<void> {
    const result = await this.imports.remove(user.id, worldId, importerId);
    if (result !== 'ok') this.unwrap(result);
  }

  /** Map a gate outcome to its HTTP exception, or pass the value through. */
  private unwrap<T>(result: T | ImportRefusal): T {
    if (result === 'not-found' || result === 'no-such-importer') throw new NotFoundException();
    if (result === 'forbidden') throw new ForbiddenException();
    return result as T;
  }
}
