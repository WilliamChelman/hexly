import { Module } from '@nestjs/common';
import { HEXLY_CONFIG, type HexlyConfig } from '../config';
import { resolveAssetsDir, resolveInstanceDir } from '../db/db';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { AssetExtractionService } from './asset-extraction.service';
import { AssetMintService } from './asset-mint.service';
import { AssetsController } from './assets.controller';
import { ASSETS_DIR, AssetsService } from './assets.service';

/**
 * Asset subsystem (ADR-0034, ADR-0065): content-addressed per-World binary storage plus its
 * unauthenticated serving route, and the mint-and-dedup that wraps an upload in an **Asset Entity**.
 * `ASSETS_DIR` is resolved once at boot, its provider injecting `hexly.yml`'s `assets.dir` the way
 * `MulterModule`'s upload ceiling does, so nothing downstream reads config for it (ADR-0036).
 * `EntitiesModule` is imported so the mint routes through the one Entity write handle (ADR-0045).
 */
@Module({
  imports: [DbModule, EntitiesModule],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    AssetMintService,
    AssetExtractionService,
    {
      provide: ASSETS_DIR,
      inject: [HEXLY_CONFIG],
      useFactory: (config: HexlyConfig) => resolveAssetsDir(resolveInstanceDir(), config.assets.dir),
    },
  ],
  exports: [AssetsService, AssetMintService],
})
export class AssetsModule {}
