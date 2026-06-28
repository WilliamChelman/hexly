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
  UseGuards,
} from '@nestjs/common';
import {
  AuthUser,
  createWorldRequestSchema,
  WorldDetail,
  WorldSummary,
} from '@hexly/domain';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { WorldsService } from './worlds.service';

/**
 * The World REST surface (ADR-0024). Every route is guarded; the World Owner
 * lives on `worlds.owner_id`. Bodies are validated against the shared Zod schema
 * (ADR-0001) so an invalid payload is a 400 here, never a 500 deeper down.
 */
@Controller('worlds')
@UseGuards(SessionAuthGuard)
export class WorldsController {
  constructor(private readonly worlds: WorldsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): WorldSummary[] {
    return this.worlds.list(user.id);
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

  // Body is the same `{ name }` shape as create — reuse its schema rather than mint a twin.
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
