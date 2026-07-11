import { Module } from '@nestjs/common';
import { resolveAssetsDir } from '../db/db';
import { DbModule } from '../db/db.module';
import { AssetsController } from './assets.controller';
import { ASSETS_DIR, AssetsService } from './assets.service';

/**
 * Asset subsystem (ADR-0034): content-addressed per-World binary storage plus its
 * unauthenticated serving route. `ASSETS_DIR` is resolved once at boot from the Instance
 * Directory (the folder beside `hexly.db`). Exports {@link AssetsService} so the World
 * import (stores bytes) and World delete (removes the folder) can reach it.
 */
@Module({
  imports: [DbModule],
  controllers: [AssetsController],
  providers: [AssetsService, { provide: ASSETS_DIR, useFactory: () => resolveAssetsDir() }],
  exports: [AssetsService],
})
export class AssetsModule {}
