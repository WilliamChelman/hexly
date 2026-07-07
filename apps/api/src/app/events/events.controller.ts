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
  Query,
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
 * The SSE nudge bus surface (ADR-0044, #173/#175). One multiplexed stream per tab: `GET /events`
 * mints a `connectionId`; `PUT /events/:connectionId/interest` declares the whole watched set.
 *
 * The principal is a session cookie **or** an anonymous Public Link `?token=` (#175) — the
 * highest-value live-follow audience is a player without an account watching a shared Entity. It
 * is *not* session-guarded: {@link resolvePrincipal} accepts either credential and 401s only when
 * neither is present, resolving the token exactly as the unguarded `GET /public/…` routes do (the
 * token *is* the grant). A token that grants nothing simply subscribes to nothing (silent).
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly bus: NudgeBus,
    private readonly auth: AuthService,
  ) {}

  /**
   * The connection's principal: a `?token=` names an anonymous Public Link connection and *wins*
   * over any session cookie — the public page is token-scoped exactly like the unguarded `GET
   * /public/…` routes, so a signed-in user opening a shared link follows as the link grants, not
   * as their own (possibly nil) rights on that Entity. Absent a token, a valid session cookie →
   * the user; neither → 401. The token isn't validated here — an unresolvable one opens a
   * connection that can never subscribe (forbidden==nonexistent silence), never a leak.
   */
  private async resolvePrincipal(req: Request, token?: string): Promise<Principal> {
    if (token) return { kind: 'token', token };
    const user = await this.auth.authenticate(req.cookies?.[SESSION_COOKIE]);
    if (user) return { kind: 'user', userId: user.id };
    throw new UnauthorizedException();
  }

  @Sse()
  events(@Req() req: Request, @Query('token') token?: string): Observable<MessageEvent> {
    // Defer the whole stream on the async principal resolve, then emit the `ready` frame and the
    // live nudges. On unsubscribe (tab closed / dropped) reap the connection so the map can't leak.
    return from(this.resolvePrincipal(req, token)).pipe(
      switchMap((principal) => {
        const { connectionId, stream } = this.bus.connect(principal);
        return concat(
          of<MessageEvent>({ type: 'ready', data: { connectionId } }),
          stream,
        ).pipe(finalize(() => this.bus.disconnect(connectionId)));
      }),
    );
  }

  @Put(':connectionId/interest')
  @HttpCode(204)
  async setInterest(
    @Req() req: Request,
    @Param('connectionId') connectionId: string,
    @Body() body: unknown,
    @Query('token') token?: string,
  ): Promise<void> {
    // safeParse + 400 (house style): a raw ZodError would surface as a 500 leaking a stack.
    const parsed = interestSetSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const principal = await this.resolvePrincipal(req, token);
    const outcome = this.bus.setInterest(connectionId, principal, parsed.data.refs);
    // An unowned connectionId is a 403 (rejected, not applied); an unknown one is a 404. Both
    // are silent about the other's existence.
    if (outcome === 'forbidden') throw new ForbiddenException();
    if (outcome === 'not-found') throw new NotFoundException();
  }
}
