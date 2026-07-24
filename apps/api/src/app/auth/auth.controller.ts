import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AuthUser,
  changePasswordRequestSchema,
  loginRequestSchema,
  Preferences,
  preferencesPatchSchema,
  updateProfileRequestSchema,
} from '@hexly/domain';
import { AuthService, SESSION_TTL_MS } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { CurrentUser } from './current-user.decorator';

/** Name of the HttpOnly cookie carrying the opaque session token. */
export const SESSION_COOKIE = 'hexly_session';

/**
 * `maxAge` matches the server session TTL, so the cookie survives a browser restart up to it.
 * `secure` is production-only: setting it would break local http dev.
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
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<AuthUser> {
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();

    const result = await this.auth.login(parsed.data.email, parsed.data.password);
    if (!result) throw new UnauthorizedException();

    res.cookie(SESSION_COOKIE, result.token, COOKIE_OPTS);
    return result.user;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTS);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Patch('me/preferences')
  @UseGuards(SessionAuthGuard)
  async updatePreferences(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<Preferences> {
    const parsed = preferencesPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.auth.updatePreferences(user.id, parsed.data);
  }

  @Patch('me/profile')
  @UseGuards(SessionAuthGuard)
  async updateProfile(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<AuthUser> {
    const parsed = updateProfileRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.auth.updateProfile(user.id, parsed.data.displayName);
  }

  @Post('me/password')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const parsed = changePasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const changed = await this.auth.changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!changed) throw new UnauthorizedException();
  }
}
