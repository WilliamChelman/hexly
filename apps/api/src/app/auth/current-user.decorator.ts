import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser } from '@hexly/domain';

// Tell Express that a guarded request carries an AuthUser on `req.user`, so the
// guard's assignment and this decorator's read are both type-safe.
declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Reads the {@link AuthUser} attached by {@link SessionAuthGuard}. Only valid on
 * handlers guarded by it; otherwise the value is undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.user;
  },
);
