import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbModule } from '../db/db.module';
import { EventsController } from './events.controller';
import { NudgeBus } from './nudge-bus';
import { WriteOutbox } from './write-outbox';

/**
 * The live-follow nudge bus module (ADR-0044). Entity write paths emit change events into
 * {@link NudgeBus} from the service layer, buffering them in {@link WriteOutbox} for the duration
 * of the transaction.
 */
@Module({
  imports: [AuthModule, DbModule],
  controllers: [EventsController],
  providers: [NudgeBus, WriteOutbox],
  exports: [NudgeBus, WriteOutbox],
})
export class EventsModule {}
