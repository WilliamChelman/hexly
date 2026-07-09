import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { EntityWrites } from './entity-writes';

/**
 * The Entity feature module (ADR-0018). Imports DbModule for the shared DB token
 * (ADR-0002) and AuthModule for the {@link SessionAuthGuard} the controller
 * guards every route with.
 */
@Module({
  imports: [DbModule, AuthModule, EventsModule],
  controllers: [EntitiesController],
  providers: [EntitiesService, EntityWrites],
  // EntitiesService is exported so the vault import (ADR-0033) can bulk-insert notes through it;
  // EntityWrites so the World cascade-delete (ADR-0045) and the Admin grant purge route their
  // `entities` / `entity_grants` writes through the one handle that nudges.
  exports: [EntitiesService, EntityWrites],
})
export class EntitiesModule {}
