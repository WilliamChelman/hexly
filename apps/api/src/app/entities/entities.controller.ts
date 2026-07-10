import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  addGrantRequestSchema,
  addOwnerRequestSchema,
  AuthUser,
  createEntityRequestSchema,
  EntityDetail,
  EntityFacets,
  EntityGrant,
  entityListQuerySchema,
  EntityPage,
  EntityReferences,
  patchEntityRequestSchema,
  PublicLink,
  saveEntityRequestSchema,
} from '@hexly/domain';
import { aclSetResponse, ownerSetResponse } from '../acl/owner-set';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { decodeCursor } from './utils/decode-cursor';
import { encodeCursor } from './utils/encode-cursor';
import { EntitiesService } from './entities.service';

/**
 * The Entity REST surface (ADR-0018). Every route is owner-scoped: the guard
 * resolves the session to a user and the service only ever touches that user's
 * rows. Bodies are validated against the shared Zod schema (ADR-0001) so an
 * invalid payload is a 400 here, never a 500 deeper down.
 */
@Controller('entities')
@UseGuards(SessionAuthGuard)
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): EntityPage {
    const parsed = entityListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { cursor, limit, ids, q, type, tag, visibility, worldId, rights } = parsed.data;

    // Absent cursor is page one; undecodable is a 400 (ADR-0001).
    const offset = cursor === undefined ? 0 : decodeCursor(cursor);
    if (offset === null) throw new BadRequestException();

    const { items, hasMore } = this.entities.list(user.id, {
      offset,
      limit,
      ids,
      q,
      type,
      tags: tag,
      visibility,
      worldId,
      withRights: rights,
    });
    return { items, nextCursor: hasMore ? encodeCursor(offset + limit) : null };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): EntityDetail {
    const parsed = createEntityRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.entities.create(user.id, parsed.data);
  }

  // Before `:id` so literal path isn't captured. Owner's `::` Link Descriptor vocabulary (#96).
  @Get('descriptors')
  descriptors(@CurrentUser() user: AuthUser): string[] {
    return this.entities.listDescriptors(user.id);
  }

  // Before `:id` so the literal path isn't captured. Owner's Tag suggestion vocabulary.
  @Get('tags')
  tags(@CurrentUser() user: AuthUser): string[] {
    return this.entities.listTags(user.id);
  }

  // Before `:id` so the literal path isn't captured (#155). Facet rail counts: each
  // category's live values under the active filters, drilled down (ADR-0035).
  @Get('facets')
  facets(@CurrentUser() user: AuthUser, @Query() query: unknown): EntityFacets {
    const parsed = entityListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const { q, type, tag, visibility, worldId } = parsed.data;
    return this.entities.facets(user.id, {
      q,
      type,
      tags: tag,
      visibility,
      worldId,
    });
  }

  @Get(':id')
  load(@CurrentUser() user: AuthUser, @Param('id') id: string): EntityDetail {
    const entity = this.entities.load(user.id, id);
    if (!entity) throw new NotFoundException();
    return entity;
  }

  /**
   * Both directions of this Entity's links (ADR-0046, #179), off the derived edge index. The
   * inbound half is filtered by the caller's access to each *source*, so it is resolved per viewer
   * and never cached across them.
   */
  @Get(':id/references')
  references(@CurrentUser() user: AuthUser, @Param('id') id: string): EntityReferences {
    const references = this.entities.references(user.id, id);
    if (!references) throw new NotFoundException();
    return references;
  }

  @Put(':id')
  @HttpCode(200)
  save(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): EntityDetail {
    const parsed = saveEntityRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const result = this.entities.save(user.id, id, parsed.data);
    switch (result.status) {
      case 'saved':
        return result.entity;
      case 'not-found':
        throw new NotFoundException();
      case 'conflict':
        // Version conflict: hand back current Entity for client re-pull (ADR-0018).
        throw new ConflictException(result.current);
    }
  }

  // A metadata patch (ADR-0037): the name and/or the Visibility. Reachable-but-forbidden
  // is a 403 (thrown in the service), an unreachable Entity a 404.
  @Patch(':id')
  patch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): EntityDetail {
    const parsed = patchEntityRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const entity = this.entities.patch(user.id, id, parsed.data);
    if (!entity) throw new NotFoundException();
    return entity;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    if (!this.entities.delete(user.id, id)) throw new NotFoundException();
  }

  // The Entity's ownership set (ADR-0037), for an Owner.
  @Get(':id/owners')
  owners(@CurrentUser() user: AuthUser, @Param('id') id: string): string[] {
    return ownerSetResponse(this.entities.listOwners(user.id, id), 'entity');
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
    return ownerSetResponse(this.entities.addOwner(user.id, id, parsed.data.userId), 'entity');
  }

  // Remove an Owner, or resign your own ownership (ADR-0037). The ≥1-Owner
  // invariant refuses removing the last Owner (409).
  @Delete(':id/owners/:userId')
  removeOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): string[] {
    return ownerSetResponse(this.entities.removeOwner(user.id, id, userId), 'entity');
  }

  // The Entity's grant set (ADR-0037, #161), for an Owner. Grants have no ≥1 invariant,
  // so the `last-owner` arm aclSetResponse maps is unreachable here — the 'entity' kind
  // it tags is never emitted.
  @Get(':id/grants')
  grants(@CurrentUser() user: AuthUser, @Param('id') id: string): EntityGrant[] {
    return aclSetResponse(this.entities.listGrants(user.id, id), 'entity');
  }

  // Grant an Instance user Editor or Viewer (ADR-0037, #161): Owner-only, target must be
  // an existing user (member or not). Upsert — re-granting updates the role — so 200.
  @Post(':id/grants')
  @HttpCode(200)
  addGrant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): EntityGrant[] {
    const parsed = addGrantRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return aclSetResponse(
      this.entities.addGrant(user.id, id, parsed.data.userId, parsed.data.role), 'entity',
    );
  }

  // Revoke a grant (ADR-0037, #161): Owner-only. Revocation is how entity-level access ends.
  @Delete(':id/grants/:userId')
  removeGrant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): EntityGrant[] {
    return aclSetResponse(this.entities.removeGrant(user.id, id, userId), 'entity');
  }

  // The Entity's per-entity Public Link (ADR-0037, #162), for an Owner: the active token or null.
  @Get(':id/link')
  link(@CurrentUser() user: AuthUser, @Param('id') id: string): PublicLink | null {
    return aclSetResponse(this.entities.getLink(user.id, id), 'entity');
  }

  // Mint (or return the existing) per-entity Public Link (ADR-0037, #162): Owner-only. One
  // active link per Entity, so a re-mint returns the current token — idempotent, hence 200.
  @Post(':id/link')
  @HttpCode(200)
  mintLink(@CurrentUser() user: AuthUser, @Param('id') id: string): PublicLink {
    return aclSetResponse(this.entities.mintLink(user.id, id), 'entity');
  }

  // Revoke the per-entity Public Link (ADR-0037, #162): Owner-only, the kill-switch.
  @Delete(':id/link')
  @HttpCode(204)
  revokeLink(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    aclSetResponse(this.entities.revokeLink(user.id, id), 'entity');
  }
}
