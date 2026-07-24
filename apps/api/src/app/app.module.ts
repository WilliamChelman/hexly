import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './admin/users.module';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { EntitiesModule } from './entities/entities.module';
import { EventsModule } from './events/events.module';
import { PublicLinksModule } from './acl/public-links.module';
import { WorldsModule } from './worlds/worlds.module';
import { HealthController } from './health.controller';
import { TestModule } from './test/test.module';

/**
 * Gates the e2e-only test endpoints (a destructive DB reset) — ADR-0009. Positive allowlist,
 * not `NODE_ENV !== 'production'`: an unset or unknown NODE_ENV (the default in a real deploy)
 * must fail closed, so the routes stay physically absent even if HEXLY_E2E=1 leaks in.
 */
const e2eTestingEnabled =
  process.env.HEXLY_E2E === '1' && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development');

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    UsersModule,
    AdminModule,
    EntitiesModule,
    EventsModule,
    WorldsModule,
    PublicLinksModule,
    AssetsModule,
    ...(e2eTestingEnabled ? [TestModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
