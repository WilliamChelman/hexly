import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { EntityWrites } from './entity-writes';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldTypeFields } from './world-type-fields';

@Module({
  imports: [DbModule, AuthModule, EventsModule],
  controllers: [EntitiesController],
  providers: [EntitiesService, EntityWrites, TypeFieldRegistry, WorldTypeFields],
  // All `entities` / `entity_grants` writes outside this module (World cascade-delete, Admin grant
  // purge, vault import) must route through EntityWrites / EntitiesService — the handles that nudge.
  exports: [EntitiesService, EntityWrites, TypeFieldRegistry, WorldTypeFields],
})
export class EntitiesModule {}
