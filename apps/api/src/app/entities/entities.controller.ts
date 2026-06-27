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
  AuthUser,
  createEntityRequestSchema,
  EntityDetail,
  entityListQuerySchema,
  EntityPage,
  renameEntityRequestSchema,
  saveEntityRequestSchema,
} from '@hexly/domain';
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
    const { cursor, limit, ids, q, type } = parsed.data;

    // An absent cursor is page one; a present-but-undecodable one is a 400, not
    // a 500 (ADR-0001). The opaque cursor decodes to a server-internal offset.
    const offset = cursor === undefined ? 0 : decodeCursor(cursor);
    if (offset === null) throw new BadRequestException();

    const { items, hasMore } = this.entities.list(user.id, {
      offset,
      limit,
      ids,
      q,
      type,
    });
    return { items, nextCursor: hasMore ? encodeCursor(offset + limit) : null };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): EntityDetail {
    const parsed = createEntityRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.entities.create(user.id, parsed.data);
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
        // The base version had moved: reject with 409 and hand back the current
        // Entity so the client can surface the conflict and re-pull (ADR-0018).
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
}
