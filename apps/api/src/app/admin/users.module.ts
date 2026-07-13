import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EntitiesModule } from '../entities/entities.module';
import { WorldsModule } from '../worlds/worlds.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * The account-management surface (ADR-0037, ADR-0047): the `manage-users` `/users`
 * routes. {@link EntitiesModule} and {@link WorldsModule} are imported for the write
 * handles that purge a deleted account's Entity grants and World memberships (ADR-0045).
 * Reaches no content: the `manage-users` role has zero content powers.
 */
@Module({
  imports: [AuthModule, DbModule, EntitiesModule, WorldsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
