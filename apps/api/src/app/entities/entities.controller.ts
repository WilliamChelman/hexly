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
  addOwnerRequestSchema,
  AuthUser,
  createEntityRequestSchema,
  EntityDetail,
  EntityFacets,
  entityListQuerySchema,
  EntityPage,
  renameEntityRequestSchema,
  saveEntityRequestSchema,
} from '@hexly/domain';
import { ownerSetResponse } from '../acl/owner-set';
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
    const { cursor, limit, ids, q, type, tag, visibility, worldId } = parsed.data;

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

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): EntityDetail {
    const parsed = renameEntityRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const entity = this.entities.rename(user.id, id, parsed.data.name);
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
    return ownerSetResponse(this.entities.listOwners(user.id, id), 'Entity');
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
    return ownerSetResponse(this.entities.addOwner(user.id, id, parsed.data.userId), 'Entity');
  }

  // Remove an Owner, or resign your own ownership (ADR-0037). The ≥1-Owner
  // invariant refuses removing the last Owner (409).
  @Delete(':id/owners/:userId')
  removeOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): string[] {
    return ownerSetResponse(this.entities.removeOwner(user.id, id, userId), 'Entity');
  }
}
