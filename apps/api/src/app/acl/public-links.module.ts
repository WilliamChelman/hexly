import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { PublicLinksController } from './public-links.controller';
import { PublicLinksService } from './public-links.service';

/**
 * The unauthenticated token-scoped read surface (ADR-0037). The mint/revoke write paths live on
 * the guarded Worlds/Entities controllers, not here.
 */
@Module({
  imports: [DbModule, EntitiesModule],
  controllers: [PublicLinksController],
  providers: [PublicLinksService],
})
export class PublicLinksModule {}
