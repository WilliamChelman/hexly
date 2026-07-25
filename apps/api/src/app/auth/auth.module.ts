import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { AuthController } from './auth.controller';
import { UserDirectoryController } from './user-directory.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  // DbModule provides the shared DB token (ADR-0002). Importing it here keeps
  // the token resolvable through AuthModule's graph, so the controller spec's
  // `.overrideProvider(DB)` in-memory swap still takes effect.
  //
  // ConfigModule likewise: the user directory is Collaboration (ADR-0071), so its guard reads
  // HEXLY_CONFIG.
  imports: [DbModule, ConfigModule],
  controllers: [AuthController, UserDirectoryController],
  // SessionAuthGuard is a provider (not registered globally) so Nest can inject
  // AuthService into it; handlers opt in per-route via `@UseGuards`.
  providers: [AuthService, SessionAuthGuard],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
