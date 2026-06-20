import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  // DbModule provides the shared DB token (ADR-0002). Importing it here keeps
  // the token resolvable through AuthModule's graph, so the controller spec's
  // `.overrideProvider(DB)` in-memory swap still takes effect.
  imports: [DbModule],
  controllers: [AuthController],
  // SessionAuthGuard is a provider (not registered globally) so Nest can inject
  // AuthService into it; handlers opt in per-route via `@UseGuards`. It is
  // exported so other feature modules (e.g. MapsModule) can guard their routes
  // with the same single definition.
  providers: [AuthService, SessionAuthGuard],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
