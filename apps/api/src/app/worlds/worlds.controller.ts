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
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
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
  // Compressed-size cap: stops a giant upload from buffering in memory before we even
  // decompress. The decompressed ceiling (the real zip-bomb guard) lives in the importer.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }),
  )
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
