import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { MapsModule } from './maps/maps.module';

@Module({
  // DbModule is @Global, but registered at the root so it owns the shared
  // connection's lifecycle (opened once, closed on shutdown).
  imports: [DbModule, AuthModule, MapsModule],
  controllers: [HealthController],
})
export class AppModule {}
