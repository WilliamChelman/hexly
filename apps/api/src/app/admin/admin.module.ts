import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from '../worlds/worlds.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * The Instance Admin feature (ADR-0037, #163). Imports {@link AuthModule} for the
 * session guard and {@link AuthService} (the shared provisioning trunk), {@link DbModule}
 * for the DB token — the same in-memory swap the specs rely on — and the two write-handle
 * modules, {@link EntitiesModule} and {@link WorldsModule}, through which a deleted account's
 * Entity grants and World memberships are purged (ADR-0045: the one write handle per table).
 */
@Module({
  imports: [AuthModule, DbModule, EntitiesModule, WorldsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
