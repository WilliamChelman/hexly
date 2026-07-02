import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { WorldsController } from './worlds.controller';
import { WorldsService } from './worlds.service';

/**
 * World feature module (ADR-0024). Imports DbModule (shared DB, ADR-0002)
 * and AuthModule (SessionAuthGuard on routes).
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [WorldsController],
  providers: [WorldsService],
})
export class WorldsModule {}
