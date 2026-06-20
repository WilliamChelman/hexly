import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser, loginRequestSchema } from '@hexly/domain';
import { AuthService, SESSION_TTL_MS } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { CurrentUser } from './current-user.decorator';

/** Name of the HttpOnly cookie carrying the opaque session token. */
export const SESSION_COOKIE = 'hexly_session';

/**
 * Cookie options for the session: HttpOnly, same-site, app-wide, with a
 * lifetime matching the server session (so it survives a browser restart up to
 * the TTL) and `secure` in production only — left off so local http dev works.
 */
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_MS,
  secure: process.env.NODE_ENV === 'production',
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUser> {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const result = await this.auth.login(parsed.data.email, parsed.data.password);
    if (!result) throw new UnauthorizedException();

    res.cookie(SESSION_COOKIE, result.token, COOKIE_OPTS);
    return result.user;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTS);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
