import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsController } from './events.controller';
import { NudgeBus } from './nudge-bus';

/**
 * The live-follow nudge bus module (ADR-0044, #173). Imports AuthModule for the
 * {@link SessionAuthGuard} guarding the stream. Exports {@link NudgeBus} so the write path
 * (EntitiesService.save) can emit change events into it from the service layer — the single
 * choke point, not the controller.
 */
@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [NudgeBus],
  exports: [NudgeBus],
})
export class EventsModule {}
