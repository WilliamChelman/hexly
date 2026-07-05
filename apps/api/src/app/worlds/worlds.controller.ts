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
  addMemberRequestSchema,
  addOwnerRequestSchema,
  AuthUser,
  createWorldRequestSchema,
  ImportSummary,
  PublicLink,
  setMemberRoleRequestSchema,
  WorldDetail,
  WorldMember,
  WorldSummary,
} from '@hexly/domain';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { aclSetResponse, ownerSetResponse } from '../acl/owner-set';
import { VaultExportService } from './vault-export.service';
import { VaultImportService } from './vault-import.service';
import { WorldsService } from './worlds.service';

/** The subset of multer's uploaded-file shape this controller uses (no @types/multer dep). */
interface UploadedZip {
  originalname: string;
  buffer: Buffer;
}


/**
 * The World REST surface (ADR-0024). Every route is guarded; World Owners are
 * the World's `world_members` rows with role 'owner' (ADR-0037). Bodies are
 * validated against the shared Zod schema (ADR-0001) so an invalid payload is a
 * 400 here, never a 500 deeper down.
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

  // The World's ownership set (ADR-0037), for an Owner.
  @Get(':id/owners')
  owners(@CurrentUser() user: AuthUser, @Param('id') id: string): string[] {
    return ownerSetResponse(this.worlds.listOwners(user.id, id), 'world');
  }

  // Add a co-Owner (ADR-0037): Owner-only, target must be an existing Instance user.
  // Returns the updated set (200), idempotent — not a 201 (adding is set membership).
  @Post(':id/owners')
  @HttpCode(200)
  addOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): string[] {
    const parsed = addOwnerRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return ownerSetResponse(this.worlds.addOwner(user.id, id, parsed.data.userId), 'world');
  }

  // Remove an Owner, or resign your own ownership (ADR-0037). The ≥1-Owner
  // invariant refuses removing the last Owner (409).
  @Delete(':id/owners/:userId')
  removeOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): string[] {
    return ownerSetResponse(this.worlds.removeOwner(user.id, id, userId), 'world');
  }

  // The World's non-owner member set (ADR-0037, #159), for an Owner. The 409 body is
  // shared by the member routes — only removeMember can raise it, but the mapper needs
  // it either way (the World that must keep an Owner is this same World).
  @Get(':id/members')
  members(@CurrentUser() user: AuthUser, @Param('id') id: string): WorldMember[] {
    return aclSetResponse(this.worlds.listMembers(user.id, id), 'world');
  }

  // Add a Contributor or World Viewer (ADR-0037, #159): Owner-only, target must be an
  // existing Instance user. Upsert — re-adding updates the role — so a 200, not a 201.
  @Post(':id/members')
  @HttpCode(200)
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): WorldMember[] {
    const parsed = addMemberRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return aclSetResponse(
      this.worlds.addMember(user.id, id, parsed.data.userId, parsed.data.role), 'world',
    );
  }

  // Change a member's role between Contributor and World Viewer (ADR-0037, #159): Owner-only.
  @Patch(':id/members/:userId')
  setMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): WorldMember[] {
    const parsed = setMemberRoleRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return aclSetResponse(
      this.worlds.setMemberRole(user.id, id, userId, parsed.data.role), 'world',
    );
  }

  // Remove a member (Owner-only) or leave the World yourself (ADR-0037, #159). The
  // ≥1-Owner invariant refuses a removal that would orphan the World (409).
  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): WorldMember[] {
    return aclSetResponse(this.worlds.removeMember(user.id, id, userId), 'world');
  }

  // The World's Public Link (ADR-0037, #162), for an Owner: the active token or null.
  @Get(':id/link')
  link(@CurrentUser() user: AuthUser, @Param('id') id: string): PublicLink | null {
    return aclSetResponse(this.worlds.getLink(user.id, id), 'world');
  }

  // Mint (or return the existing) World Public Link (ADR-0037, #162): World-Owner-only. One
  // active link per World, so a re-mint returns the current token — idempotent, hence 200.
  @Post(':id/link')
  @HttpCode(200)
  mintLink(@CurrentUser() user: AuthUser, @Param('id') id: string): PublicLink {
    return aclSetResponse(this.worlds.mintLink(user.id, id), 'world');
  }

  // Revoke the World Public Link (ADR-0037, #162): World-Owner-only, the kill-switch.
  @Delete(':id/link')
  @HttpCode(204)
  revokeLink(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    aclSetResponse(this.worlds.revokeLink(user.id, id), 'world');
  }
}
