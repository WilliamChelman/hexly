import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { MapsModule } from './maps/maps.module';
import { TestModule } from './test/test.module';

/**
 * Mount the e2e-only test endpoints (a destructive DB reset) ONLY when explicitly
 * opted in AND never in production. The route is therefore physically absent from
 * a real deploy — a 404, not a guarded handler one misconfigured env var away
 * from firing (ADR-0009).
 */
const e2eTestingEnabled =
  process.env.HEXLY_E2E === '1' && process.env.NODE_ENV !== 'production';

@Module({
  // DbModule is @Global, but registered at the root so it owns the shared
  // connection's lifecycle (opened once, closed on shutdown).
  imports: [
    DbModule,
    AuthModule,
    MapsModule,
    ...(e2eTestingEnabled ? [TestModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
