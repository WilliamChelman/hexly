import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

/**
 * The Hex Map feature module. Imports DbModule for the shared DB token
 * (ADR-0002) and AuthModule for the {@link SessionAuthGuard} the controller
 * guards every route with.
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [MapsController],
  providers: [MapsService],
})
export class MapsModule {}
