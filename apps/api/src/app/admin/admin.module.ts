import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * The Superadmin operator surface (ADR-0037, ADR-0046, ADR-0047): the `/admin` repair
 * routes (Reindex today). Reaches all content — the repair tier.
 */
@Module({
  imports: [AuthModule, DbModule, EntitiesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
