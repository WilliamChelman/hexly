import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EventsModule } from '../events/events.module';
import { EntitiesController } from './entities.controller';
import { EntitiesService } from './entities.service';
import { EntityWrites } from './entity-writes';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldTypeFields } from './world-type-fields';

/**
 * The Entity feature module (ADR-0018). Imports DbModule for the shared DB token
 * (ADR-0002) and AuthModule for the {@link SessionAuthGuard} the controller
 * guards every route with.
 */
@Module({
  imports: [DbModule, AuthModule, EventsModule],
  controllers: [EntitiesController],
  providers: [EntitiesService, EntityWrites, TypeFieldRegistry, WorldTypeFields],
  // EntitiesService is exported so the vault import (ADR-0033) can bulk-insert notes through it;
  // EntityWrites so the World cascade-delete (ADR-0045) and the Admin grant purge route their
  // `entities` / `entity_grants` writes through the one handle that nudges. TypeFieldRegistry is
  // exported so a bundled plugin (or a test) can register its type's Field schema (ADR-0048).
  // WorldTypeFields is exported so the World feature can read a World's available types (plugin +
  // user-defined) without a module cycle — it lives here because the write-path gate resolves
  // through it.
  exports: [EntitiesService, EntityWrites, TypeFieldRegistry, WorldTypeFields],
})
export class EntitiesModule {}
