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
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuthUser,
  createWorldRequestSchema,
  ImportSummary,
  WorldDetail,
  WorldSummary,
} from '@hexly/domain';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { VaultExportService } from './vault-export.service';
import { VaultImportService } from './vault-import.service';
import { WorldsService } from './worlds.service';

/** The subset of multer's uploaded-file shape this controller uses (no @types/multer dep). */
interface UploadedZip {
  originalname: string;
  buffer: Buffer;
}

/**
 * The World REST surface (ADR-0024). Every route is guarded; the World Owner
 * lives on `worlds.owner_id`. Bodies are validated against the shared Zod schema
 * (ADR-0001) so an invalid payload is a 400 here, never a 500 deeper down.
 */
@Controller('worlds')
@UseGuards(SessionAuthGuard)
export class WorldsController {
  constructor(
    private readonly worlds: WorldsService,
    private readonly importer: VaultImportService,
    private readonly exporter: VaultExportService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): WorldSummary[] {
    return this.worlds.list(user.id);
  }

  /**
   * Import an Obsidian vault `.zip` into a fresh World (ADR-0033, #146). Hexly's
   * first multipart endpoint: multer buffers the upload in memory, the import runs
   * synchronously, and the {@link ImportSummary} reports what landed and what was lost.
   */
  @Post('import')
  // Compressed-size cap (stops a giant upload buffering in memory before we decompress)
  // is set instance-wide via MulterModule (ADR-0036) and inherited here. The decompressed
  // ceiling (the real zip-bomb guard) lives in the importer, also config-driven.
  @UseInterceptors(FileInterceptor('file'))
  import(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedZip | undefined,
  ): ImportSummary {
    if (!file) throw new BadRequestException();
    return this.importer.import(user.id, file.originalname, file.buffer);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): WorldDetail {
    const parsed = createWorldRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.worlds.create(user.id, parsed.data);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): WorldDetail {
    const world = this.worlds.get(user.id, id);
    if (!world) throw new NotFoundException();
    return world;
  }

  /**
   * Export a World to a `.zip` of markdown + assets in the original folder shape (ADR-0033, #150).
   * Owner-only: a member who can read the World still can't export it (404 vs 403 mirror the
   * rename/delete surface). Uses `@Res()` to stream the binary body — Nest's JSON serializer would
   * otherwise mangle the Buffer.
   */
  @Get(':id/export')
  export(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): void {
    const result = this.exporter.export(user.id, id);
    if (result === 'not-found') throw new NotFoundException();
    if (result === 'forbidden') throw new ForbiddenException();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename.replace(/"/g, '')}"; ` +
        `filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    res.send(result.zip);
  }

  // Reuse create schema (both use { name } shape).
  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): WorldDetail {
    const parsed = createWorldRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const result = this.worlds.rename(user.id, id, parsed.data.name);
    if (result === null) throw new NotFoundException();
    if (result === 'forbidden') throw new ForbiddenException();
    return result;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    const result = this.worlds.delete(user.id, id);
    if (result === null) throw new NotFoundException();
    if (result === 'forbidden') throw new ForbiddenException();
  }
}
