import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * The Instance Admin feature (ADR-0037, #163). Imports {@link AuthModule} for the
 * session guard and {@link AuthService} (the shared provisioning trunk) and
 * {@link DbModule} for the DB token — the same in-memory swap the specs rely on.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
