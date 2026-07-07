import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  Put,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, concat, finalize, of } from 'rxjs';
import { AuthUser, interestSetSchema } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { NudgeBus } from './nudge-bus';

/**
 * The SSE nudge bus surface (ADR-0044, #173). One multiplexed stream per tab: `GET /events`
 * mints a `connectionId`; `PUT /events/:connectionId/interest` declares the whole watched set.
 * Session-guarded for now — the anonymous Public Link principal is a later slice (#171).
 */
@Controller('events')
@UseGuards(SessionAuthGuard)
export class EventsController {
  constructor(private readonly bus: NudgeBus) {}

  @Sse()
  events(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const { connectionId, stream } = this.bus.connect(user.id);
    // First frame names the connection; then the live nudge stream. On unsubscribe (the client
    // closed the tab / dropped) reap the connection so the in-memory map can't leak.
    return concat(
      of<MessageEvent>({ type: 'ready', data: { connectionId } }),
      stream,
    ).pipe(finalize(() => this.bus.disconnect(connectionId)));
  }

  @Put(':connectionId/interest')
  @HttpCode(204)
  setInterest(
    @CurrentUser() user: AuthUser,
    @Param('connectionId') connectionId: string,
    @Body() body: unknown,
  ): void {
    // safeParse + 400 (house style): a raw ZodError would surface as a 500 leaking a stack.
    const parsed = interestSetSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const outcome = this.bus.setInterest(connectionId, user.id, parsed.data.refs);
    // An unowned connectionId is a 403 (rejected, not applied); an unknown one is a 404. Both
    // are silent about the other's existence.
    if (outcome === 'forbidden') throw new ForbiddenException();
    if (outcome === 'not-found') throw new NotFoundException();
  }
}
