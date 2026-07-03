import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AssetsModule } from '../assets/assets.module';
import { AuthModule } from '../auth/auth.module';
import { HEXLY_CONFIG, type HexlyConfig } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { VaultImportService, VaultUnzipper } from './vault-import.service';
import { WorldsController } from './worlds.controller';
import { WorldsService } from './worlds.service';

/**
 * World feature module (ADR-0024). Imports DbModule (shared DB, ADR-0002),
 * AuthModule (SessionAuthGuard on routes), and EntitiesModule so the vault
 * import (ADR-0033) can insert notes through EntitiesService.
 *
 * `MulterModule.registerAsync` sets the upload `fileSize` from the Instance
 * Configuration (ADR-0036), which the import route's bare `FileInterceptor('file')`
 * inherits — the factory runs at boot, so the config-driven limit needs no
 * decorator argument (which would evaluate before DI exists).
 */
@Module({
  imports: [
    DbModule,
    AuthModule,
    EntitiesModule,
    AssetsModule,
    MulterModule.registerAsync({
      inject: [HEXLY_CONFIG],
      useFactory: (config: HexlyConfig) => ({
        limits: { fileSize: config.import.maxUpload, files: 1 },
      }),
    }),
  ],
  controllers: [WorldsController],
  providers: [WorldsService, VaultImportService, VaultUnzipper],
})
export class WorldsModule {}
