import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { PublicLinksController } from './public-links.controller';
import { PublicLinksService } from './public-links.service';

/**
 * The Public Link read module (ADR-0037, #162): the unauthenticated token-scoped read
 * surface. Imports DbModule (token resolution, ADR-0002) and EntitiesModule (reuses
 * {@link EntitiesService} to build read-only Entity detail/summaries). The mint/revoke
 * write paths live on the guarded Worlds/Entities controllers, not here.
 */
@Module({
  imports: [DbModule, EntitiesModule],
  controllers: [PublicLinksController],
  providers: [PublicLinksService],
})
export class PublicLinksModule {}
