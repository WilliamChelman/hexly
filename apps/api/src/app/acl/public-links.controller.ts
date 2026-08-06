import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CompendiumSummary, EntityDetail, PublicWorldView } from '@hexly/domain';
import { CollaborationGuard } from './collaboration.guard';
import { PublicLinksService } from './public-links.service';

/**
 * The unauthenticated Public Link read surface (ADR-0037). No {@link SessionAuthGuard} — and GET-only:
 * possession of the token is the sole credential, so any write verb hits no route (404). An unresolved
 * (revoked/never-minted) token is a 404, indistinguishable from a bad token — no existence leak
 * (ADR-0004). The whole surface is Collaboration, so the gate sits on the class (ADR-0071).
 */
@Controller('public')
@UseGuards(CollaborationGuard)
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

  // One mounted **Compendium**'s terms, scoped to the World Public Link's Mounts (ADR-0080, #410).
  @Get('worlds/:token/compendiums/:id')
  worldCompendium(@Param('token') token: string, @Param('id') id: string): CompendiumSummary {
    const compendium = this.links.readCompendium(token, id);
    if (!compendium) throw new NotFoundException();
    return compendium;
  }
}
