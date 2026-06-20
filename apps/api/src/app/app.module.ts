import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';

@Module({
  // DbModule is @Global, but registered at the root so it owns the shared
  // connection's lifecycle (opened once, closed on shutdown).
  imports: [DbModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
