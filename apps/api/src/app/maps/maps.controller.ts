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
  UseGuards,
} from '@nestjs/common';
import {
  AuthUser,
  createMapRequestSchema,
  MapDetail,
  MapSummary,
  renameMapRequestSchema,
  saveMapRequestSchema,
} from '@hexly/domain';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { MapsService } from './maps.service';

/**
 * The Hex Map REST surface (issue #6). Every route is owner-scoped: the guard
 * resolves the session to a user and the service only ever touches that user's
 * rows. Bodies are validated against the shared Zod schema (ADR-0001) so an
 * invalid payload is a 400 here, never a 500 deeper down.
 */
@Controller('maps')
@UseGuards(SessionAuthGuard)
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): MapSummary[] {
    return this.maps.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): MapDetail {
    const parsed = createMapRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.maps.create(user.id, parsed.data);
  }

  @Get(':id')
  load(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): MapDetail {
    const map = this.maps.load(user.id, id);
    if (!map) throw new NotFoundException();
    return map;
  }

  @Put(':id')
  @HttpCode(200)
  save(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): MapDetail {
    const parsed = saveMapRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const result = this.maps.save(user.id, id, parsed.data);
    switch (result.status) {
      case 'saved':
        return result.map;
      case 'not-found':
        throw new NotFoundException();
      case 'conflict':
        // The base version had moved: reject with 409 and hand back the current
        // map so the client can surface the conflict and re-pull (issue #6).
        throw new ConflictException(result.current);
    }
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): MapDetail {
    const parsed = renameMapRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const map = this.maps.rename(user.id, id, parsed.data.title);
    if (!map) throw new NotFoundException();
    return map;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    if (!this.maps.delete(user.id, id)) throw new NotFoundException();
  }
}
