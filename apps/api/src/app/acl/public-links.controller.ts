import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { EntityDetail, PublicWorldView } from '@hexly/domain';
import { PublicLinksService } from './public-links.service';

/**
 * The unauthenticated Public Link read surface (ADR-0037, #162). Deliberately unguarded —
 * no {@link SessionAuthGuard} — and GET-only: possession of the token is the sole credential,
 * and the whole surface is strictly read-only, so any write verb hits no route (a 404).
 * Every route is scoped exactly to its token; an unresolved (revoked/never-minted) token
 * is a 404, indistinguishable from a bad token — no existence leak (ADR-0004).
 */
@Controller('public')
export class PublicLinksController {
  constructor(private readonly links: PublicLinksService) {}

  // A per-entity Public Link → that one Entity, read-only (pierces `private`).
  @Get('entities/:token')
  entity(@Param('token') token: string): EntityDetail {
    const entity = this.links.readEntity(token);
    if (!entity) throw new NotFoundException();
    return entity;
  }

  // A World Public Link → the World's identity + its `shared` Entity summaries, nothing else.
  @Get('worlds/:token')
  world(@Param('token') token: string): PublicWorldView {
    const view = this.links.readWorld(token);
    if (!view) throw new NotFoundException();
    return view;
  }

  // One `shared` Entity's read-only body, scoped to the World Public Link's World.
  @Get('worlds/:token/entities/:id')
  worldEntity(@Param('token') token: string, @Param('id') id: string): EntityDetail {
    const entity = this.links.readWorldEntity(token, id);
    if (!entity) throw new NotFoundException();
    return entity;
  }
}
