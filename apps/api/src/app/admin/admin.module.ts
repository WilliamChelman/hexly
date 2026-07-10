import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from '../worlds/worlds.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';

/**
 * The two administration tiers (ADR-0037, #163). Imports {@link AuthModule} for the
 * session guard and {@link AuthService} (the shared provisioning trunk), {@link DbModule}
 * for the DB token — the same in-memory swap the specs rely on — and the two write-handle
 * modules, {@link EntitiesModule} and {@link WorldsModule}, through which a deleted account's
 * Entity grants and World memberships are purged (ADR-0045: the one write handle per table).
 *
 * One module, two surfaces: {@link AdminController} manages accounts and reaches no content,
 * while {@link SuperadminController} is the repair tier that reaches all of it (ADR-0046). They
 * share a guard file and nothing else.
 */
@Module({
  imports: [AuthModule, DbModule, EntitiesModule, WorldsModule],
  controllers: [AdminController, SuperadminController],
  providers: [AdminService, SuperadminService],
})
export class AdminModule {}
