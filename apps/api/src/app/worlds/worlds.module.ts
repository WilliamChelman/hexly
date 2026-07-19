import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AssetsModule } from '../assets/assets.module';
import { AuthModule } from '../auth/auth.module';
import { HEXLY_CONFIG, type HexlyConfig } from '../config';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { EventsModule } from '../events/events.module';
import { ImporterRegistry } from './importer-registry';
import { ImportReconcileService } from './import-reconcile.service';
import { VaultExportService } from './vault-export.service';
import { VaultImportService } from './vault-import.service';
import { VaultUnzipper } from './vault-unzipper';
import { WorldGraphService } from './world-graph.service';
import { WorldImportersController } from './world-importers.controller';
import { WorldsController } from './worlds.controller';
import { WorldsService } from './worlds.service';
import { WorldTypesService } from './world-types.service';
import { WorldFieldsService } from './world-fields.service';
import { WorldWrites } from './world-writes';

/**
 * World feature module (ADR-0024).
 *
 * `MulterModule.registerAsync` sets the upload `fileSize` from the Instance Configuration
 * (ADR-0036), which the import route's bare `FileInterceptor('file')` inherits: a decorator
 * argument would evaluate before DI exists.
 */
@Module({
  imports: [
    DbModule,
    AuthModule,
    EntitiesModule,
    EventsModule,
    AssetsModule,
    MulterModule.registerAsync({
      inject: [HEXLY_CONFIG],
      useFactory: (config: HexlyConfig) => ({
        limits: { fileSize: config.import.maxUpload, files: 1 },
      }),
    }),
  ],
  controllers: [WorldsController, WorldImportersController],
  providers: [
    WorldsService,
    WorldTypesService,
    WorldFieldsService,
    WorldWrites,
    WorldGraphService,
    VaultImportService,
    VaultExportService,
    VaultUnzipper,
    ImporterRegistry,
    ImportReconcileService,
  ],
  // WorldWrites is exported so the Admin account purge (ADR-0045) routes its `world_members`
  // deletion through the one handle that bumps `seq` — the World peer of EntityWrites.
  // ImporterRegistry is exported so the e2e-only TestModule can swap the Draw Steel monsters
  // Importer's codeload fetch port (ADR-0061) for its committed fixtures — an offline import run.
  exports: [WorldWrites, ImporterRegistry],
})
export class WorldsModule {}
