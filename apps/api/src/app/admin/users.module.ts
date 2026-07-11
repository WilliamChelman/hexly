import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from '../worlds/worlds.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * The account-management surface (ADR-0037, ADR-0047): the `manage-users` `/users`
 * routes. Imports {@link AuthModule} for the session guard and {@link AuthService}
 * (the shared provisioning trunk), {@link DbModule} for the DB token — the same
 * in-memory swap the specs rely on — and the two write-handle modules,
 * {@link EntitiesModule} and {@link WorldsModule}, through which a deleted account's
 * Entity grants and World memberships are purged (ADR-0045: the one write handle per
 * table). Reaches no content: the `manage-users` role has zero content powers.
 */
@Module({
  imports: [AuthModule, DbModule, EntitiesModule, WorldsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
