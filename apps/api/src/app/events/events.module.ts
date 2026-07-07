import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EventsController } from './events.controller';
import { NudgeBus } from './nudge-bus';

/**
 * The live-follow nudge bus module (ADR-0044, #173/#175). Imports AuthModule for the
 * {@link AuthService} that resolves a stream's cookie-or-token principal (#175), DbModule for the
 * emit-time reachability check on the access seam (#174). Exports {@link NudgeBus} so the Entity
 * write paths can emit change events into it from the service layer — the single choke point, not
 * the controller.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [EventsController],
  providers: [NudgeBus],
  exports: [NudgeBus],
})
export class EventsModule {}
