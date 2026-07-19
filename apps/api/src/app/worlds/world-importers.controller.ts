import {
  BadRequestException,
  Body,
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
import { AuthUser, ImporterSummary, ImportRunSummary, runImportRequestSchema } from '@hexly/domain';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ImportGate, ImportReconcileService } from './import-reconcile.service';

/**
 * The per-World import surface (ADR-0060) — the generic, importer-agnostic feature mounted under the
 * World the way vault import hangs off the Worlds surface. Every route is Owner-gated in the service
 * (unreachable World ≡ 404, reachable-but-not-Owner ≡ 403), so a non-Owner never reaches an Importer.
 * The controller is importer-agnostic: it lists whatever Importers the enabled Plugins registered, and
 * runs / polls / removes them through the one reconcile.
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
   * Run (or reimport) an Importer into this World with a chosen Visibility, and return at once (202) —
   * the reconcile outlives the request; poll {@link status}. A second run while one is in flight is a
   * 409 (raised in the service). An unknown Importer is a 404.
   */
  @Post('importers/:importerId/run')
  @HttpCode(202)
  run(
    @CurrentUser() user: AuthUser,
    @Param('worldId') worldId: string,
    @Param('importerId') importerId: string,
    @Body() body: unknown,
  ): ImportRunSummary {
    const parsed = runImportRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.unwrap(this.imports.start(user.id, worldId, importerId, parsed.data.visibility));
  }

  /** Where this World's import run stands — the poll target for a running reconcile, plus the last finished run. */
  @Get('import/status')
  status(@CurrentUser() user: AuthUser, @Param('worldId') worldId: string): ImportRunSummary {
    return this.unwrap(this.imports.status(user.id, worldId));
  }

  /** Remove an Importer's whole set from this World (no recreate). Hand-authored Entities are left intact. */
  @Delete('importers/:importerId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('worldId') worldId: string,
    @Param('importerId') importerId: string,
  ): void {
    const result = this.imports.remove(user.id, worldId, importerId);
    if (result !== 'ok') this.unwrap(result);
  }

  /** Map a gate outcome to its HTTP exception, or pass the value through. */
  private unwrap<T>(result: T | ImportGate): T {
    if (result === 'not-found' || result === 'no-such-importer') throw new NotFoundException();
    if (result === 'forbidden') throw new ForbiddenException();
    return result as T;
  }
}
