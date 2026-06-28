import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { WorldsController } from './worlds.controller';
import { WorldsService } from './worlds.service';

/**
 * The World feature module (ADR-0024). Imports DbModule for the shared DB token
 * (ADR-0002) and AuthModule for the {@link SessionAuthGuard} guarding every route.
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [WorldsController],
  providers: [WorldsService],
})
export class WorldsModule {}
