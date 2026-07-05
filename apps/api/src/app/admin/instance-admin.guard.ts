import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Gates the Instance Admin surface (ADR-0037, #163): account management. Layered
 * *after* {@link SessionAuthGuard} (which resolves the session to `req.user`), so
 * a missing session is already a 401 by the time this runs. A signed-in non-Admin
 * is a 403. Superadmin ⊇ Admin: the operator's in-app self carries the account
 * powers too, so either flag passes.
 */
@Injectable()
export class InstanceAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user?.isAdmin && !user?.isSuperadmin) throw new ForbiddenException();
    return true;
  }
}

/**
 * Gates the Superadmin-only surface (ADR-0037, #163): the repair tier — currently
 * the Superadmin-flag toggle. Stricter than {@link InstanceAdminGuard}: an Instance
 * Admin without the Superadmin flag is a 403, because promoting/demoting the
 * operator's tier is the operator's own power.
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user?.isSuperadmin) throw new ForbiddenException();
    return true;
  }
}
