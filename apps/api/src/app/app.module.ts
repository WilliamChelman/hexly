import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { EntitiesModule } from './entities/entities.module';
import { HealthController } from './health.controller';
import { TestModule } from './test/test.module';

/**
 * Mount the e2e-only test endpoints (a destructive DB reset) ONLY when explicitly
 * opted in AND running under a recognised non-production environment. This uses a
 * fail-safe positive allowlist (NODE_ENV must be 'test' or 'development') rather
 * than a negative `!== 'production'` check: an unset or unknown NODE_ENV — the
 * default in a real deploy, since nothing here sets NODE_ENV at runtime — fails
 * closed and can NEVER satisfy the guard. The route therefore stays physically
 * absent from a real deploy (a 404, not a guarded handler one misconfigured env
 * var away from firing) even if HEXLY_E2E=1 ever leaks in (ADR-0009). The e2e
 * harness launches the server with NODE_ENV=test, so the route still mounts there.
 */
const e2eTestingEnabled =
  process.env.HEXLY_E2E === '1' &&
  (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development');

@Module({
  // DbModule is @Global, but registered at the root so it owns the shared
  // connection's lifecycle (opened once, closed on shutdown).
  imports: [
    DbModule,
    AuthModule,
    EntitiesModule,
    ...(e2eTestingEnabled ? [TestModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
