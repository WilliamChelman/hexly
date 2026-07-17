import {
  BadRequestException,
  Body,
  ConflictException,
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
  AvailableType,
  createUserDefinedTypeRequestSchema,
  createWorldFieldRequestSchema,
  createWorldRequestSchema,
  Field,
  ImportSummary,
  PublicLink,
  setMemberRoleRequestSchema,
  updateUserDefinedTypeRequestSchema,
  updateWorldFieldRequestSchema,
  updateWorldRequestSchema,
  UserDefinedType,
  WorldDetail,
  WorldGraph,
  WorldMember,
  WorldSummary,
} from '@hexly/domain';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CanCreateWorldsGuard } from './can-create-worlds.guard';
import { aclSetResponse, ownerSetResponse } from '../acl/owner-set';
import { VaultExportService } from './vault-export.service';
import { VaultImportService } from './vault-import.service';
import { WorldGraphService } from './world-graph.service';
import { WorldsService } from './worlds.service';
import { TypeResult, WorldTypesService } from './world-types.service';
import { WorldFieldsService } from './world-fields.service';

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
    private readonly types: WorldTypesService,
    private readonly fields: WorldFieldsService,
    private readonly importer: VaultImportService,
    private readonly exporter: VaultExportService,
    private readonly graphs: WorldGraphService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): WorldSummary[] {
    return this.worlds.list(user.id);
  }

  /**
   * Import an Obsidian vault `.zip` into a fresh World (ADR-0033). Multer buffers the upload in
   * memory, the import runs synchronously, and the {@link ImportSummary} reports what landed and
   * what was lost.
   */
  @Post('import')
  // Import mints a World, so it needs the World Creation capability too (ADR-0040).
  @UseGuards(CanCreateWorldsGuard)
  // Compressed-size cap (stops a giant upload buffering in memory before we decompress)
  // is set instance-wide via MulterModule (ADR-0036) and inherited here. The decompressed
  // ceiling (the real zip-bomb guard) lives in the importer, also config-driven.
  @UseInterceptors(FileInterceptor('file'))
  import(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedZip | undefined): ImportSummary {
    if (!file) throw new BadRequestException();
    return this.importer.import(user.id, file.originalname, file.buffer);
  }

  // World Creation capability required (ADR-0040); Superadmin bypasses in the guard.
  @Post()
  @UseGuards(CanCreateWorldsGuard)
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
  export(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response): void {
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

  /**
   * The World Graph (ADR-0046): the World's readable Entities as nodes, their Entity Links as edges.
   * Reachable to anyone who can reach the World — the Entity-level filter inside decides what they
   * actually see, so a World Viewer gets a graph of the `shared` Entities alone.
   *
   * ponytail: one unbounded full-World payload, no windowing or node cap.
   */
  @Get(':id/graph')
  graph(@CurrentUser() user: AuthUser, @Param('id') id: string): WorldGraph {
    const graph = this.graphs.graph(user.id, id);
    if (!graph) throw new NotFoundException();
    return graph;
  }

  // A partial update of the Owner-curated fields: `name` (rename) and/or `pinnedEntityIds`
  // (Dashboard pins, #168). Owner-gated in the service; reachable-but-not-Owner is a 403.
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): WorldDetail {
    const parsed = updateWorldRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const result = this.worlds.update(user.id, id, parsed.data);
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

  // The Entity Types available in a World (#191): plugin + user-defined. Reachable-gated (any member).
  @Get(':id/types')
  availableTypes(@CurrentUser() user: AuthUser, @Param('id') id: string): AvailableType[] {
    const result = this.types.listAvailable(user.id, id);
    if (result === 'not-found') throw new NotFoundException();
    return result;
  }

  // Author a new user-defined type (#191): Owner-only, id unique in the World (else 409).
  @Post(':id/types')
  createType(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): UserDefinedType {
    const parsed = createUserDefinedTypeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.typeResult(this.types.create(user.id, id, parsed.data));
  }

  // Rename / re-Field a user-defined type (#191): Owner-only. The id is immutable, so it is a path param.
  @Patch(':id/types/:typeId')
  updateType(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('typeId') typeId: string,
    @Body() body: unknown,
  ): UserDefinedType {
    const parsed = updateUserDefinedTypeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.typeResult(this.types.update(user.id, id, typeId, parsed.data));
  }

  // Delete a user-defined type (#191): Owner-only. Entities keep their EntityDocument (a Field is a lens).
  @Delete(':id/types/:typeId')
  @HttpCode(204)
  removeType(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('typeId') typeId: string): void {
    this.typeResult(this.types.delete(user.id, id, typeId));
  }

  // The World-defined Fields (#230, ADR-0054): the resolver and attach picker source. Reachable-gated.
  @Get(':id/fields')
  fieldsFor(@CurrentUser() user: AuthUser, @Param('id') id: string): Field[] {
    const result = this.fields.list(user.id, id);
    if (result === 'not-found') throw new NotFoundException();
    return result;
  }

  // Author a new World-defined Field (#230, ADR-0056): Owner-only. The server slugs the `world.<segment>`
  // id/key from the payload; a derived slug colliding with an existing Field is refused (409).
  @Post(':id/fields')
  createField(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): Field {
    const parsed = createWorldFieldRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.typeResult(this.fields.create(user.id, id, parsed.data));
  }

  // Re-body a World-defined Field (#230): Owner-only. The id is immutable, so it is a path param.
  @Patch(':id/fields/:fieldId')
  updateField(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ): Field {
    const parsed = updateWorldFieldRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.typeResult(this.fields.update(user.id, id, fieldId, parsed.data));
  }

  // Delete a World-defined Field (#230): Owner-only. Entities referencing it degrade to plain values.
  @Delete(':id/fields/:fieldId')
  @HttpCode(204)
  removeField(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('fieldId') fieldId: string): void {
    this.typeResult(this.fields.delete(user.id, id, fieldId));
  }

  /** Map a {@link TypeResult} to its HTTP outcome: `ok` unwraps, else the status's exception. */
  private typeResult<T>(result: TypeResult<T>): T {
    switch (result.status) {
      case 'not-found':
        throw new NotFoundException();
      case 'forbidden':
        throw new ForbiddenException();
      case 'conflict':
        throw new ConflictException();
      case 'ok':
        return result.value;
    }
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
  addOwner(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): string[] {
    const parsed = addOwnerRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return ownerSetResponse(this.worlds.addOwner(user.id, id, parsed.data.userId), 'world');
  }

  // Remove an Owner, or resign your own ownership (ADR-0037). The ≥1-Owner
  // invariant refuses removing the last Owner (409).
  @Delete(':id/owners/:userId')
  removeOwner(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string): string[] {
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
  addMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): WorldMember[] {
    const parsed = addMemberRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return aclSetResponse(this.worlds.addMember(user.id, id, parsed.data.userId, parsed.data.role), 'world');
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
    return aclSetResponse(this.worlds.setMemberRole(user.id, id, userId, parsed.data.role), 'world');
  }

  // Remove a member (Owner-only) or leave the World yourself (ADR-0037, #159). The
  // ≥1-Owner invariant refuses a removal that would orphan the World (409).
  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string): WorldMember[] {
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
