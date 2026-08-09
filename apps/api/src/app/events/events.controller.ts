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
  Req,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, concat, finalize, from, of, switchMap } from 'rxjs';
import { interestSetSchema } from '@hexly/domain';
import { AuthService } from '../auth/auth.service';
import { SESSION_COOKIE } from '../auth/auth.controller';
import { NudgeBus, Principal } from './nudge-bus';

/**
 * The SSE nudge bus surface (ADR-0044). One multiplexed stream per tab: `GET /events` mints a
 * `connectionId`; `PUT /events/:connectionId/interest` declares the whole watched set.
 *
 * The principal is the session cookie only: ADR-0084 retired the anonymous Public Link path, so
 * there is no `?token=` — {@link resolvePrincipal} 401s when the cookie is absent or invalid.
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly bus: NudgeBus,
    private readonly auth: AuthService,
  ) {}

  /** The connection's principal: a valid session cookie → the user; otherwise 401 (ADR-0084). */
  private async resolvePrincipal(req: Request): Promise<Principal> {
    const user = await this.auth.authenticate(req.cookies?.[SESSION_COOKIE]);
    if (user) return { kind: 'user', userId: user.id };
    throw new UnauthorizedException();
  }

  @Sse()
  events(@Req() req: Request): Observable<MessageEvent> {
    // Defer the whole stream on the async principal resolve, then emit the `ready` frame and the
    // live nudges. On unsubscribe (tab closed / dropped) reap the connection so the map can't leak.
    return from(this.resolvePrincipal(req)).pipe(
      switchMap((principal) => {
        const { connectionId, stream } = this.bus.connect(principal);
        return concat(of<MessageEvent>({ type: 'ready', data: { connectionId } }), stream).pipe(
          finalize(() => this.bus.disconnect(connectionId)),
        );
      }),
    );
  }

  @Put(':connectionId/interest')
  @HttpCode(204)
  async setInterest(
    @Req() req: Request,
    @Param('connectionId') connectionId: string,
    @Body() body: unknown,
  ): Promise<void> {
    // safeParse + 400 (house style): a raw ZodError would surface as a 500 leaking a stack.
    const parsed = interestSetSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const principal = await this.resolvePrincipal(req);
    const outcome = this.bus.setInterest(connectionId, principal, parsed.data.refs);
    // An unowned connectionId is a 403 (rejected, not applied); an unknown one is a 404. Both
    // are silent about the other's existence.
    if (outcome === 'forbidden') throw new ForbiddenException();
    if (outcome === 'not-found') throw new NotFoundException();
  }
}
