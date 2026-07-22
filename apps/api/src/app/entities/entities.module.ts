import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { EntityDeletionRegistry } from './entity-deletion-registry';
import { EntityWrites } from './entity-writes';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldFields } from './world-fields';
import { WorldTypeFields } from './world-type-fields';

@Module({
  imports: [DbModule, AuthModule, EventsModule],
  controllers: [EntitiesController],
  providers: [EntitiesService, EntityWrites, EntityDeletionRegistry, TypeFieldRegistry, WorldFields, WorldTypeFields],
  // All `entities` / `entity_grants` writes outside this module (World cascade-delete, Admin grant
  // purge, vault import) must route through EntityWrites / EntitiesService — the handles that nudge.
  // EntityDeletionRegistry is exported so the assets module registers its byte reaper on it (ADR-0065).
  exports: [EntitiesService, EntityWrites, EntityDeletionRegistry, TypeFieldRegistry, WorldFields, WorldTypeFields],
})
export class EntitiesModule {}
