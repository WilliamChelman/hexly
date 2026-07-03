import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';

/**
 * The Entity feature module (ADR-0018). Imports DbModule for the shared DB token
 * (ADR-0002) and AuthModule for the {@link SessionAuthGuard} the controller
 * guards every route with.
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [EntitiesController],
  providers: [EntitiesService],
  // Exported so the vault import (ADR-0033) can bulk-insert notes through it.
  exports: [EntitiesService],
})
export class EntitiesModule {}
