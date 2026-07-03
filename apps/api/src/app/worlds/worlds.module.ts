import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { VaultImportService } from './vault-import.service';
import { WorldsController } from './worlds.controller';
import { WorldsService } from './worlds.service';

/**
 * World feature module (ADR-0024). Imports DbModule (shared DB, ADR-0002),
 * AuthModule (SessionAuthGuard on routes), and EntitiesModule so the vault
 * import (ADR-0033) can insert notes through EntitiesService.
 */
@Module({
  imports: [DbModule, AuthModule, EntitiesModule],
  controllers: [WorldsController],
  providers: [WorldsService, VaultImportService],
})
export class WorldsModule {}
