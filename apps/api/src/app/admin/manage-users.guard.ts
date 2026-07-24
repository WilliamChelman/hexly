import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { canManageUsers } from '@hexly/domain';
import type { Request } from 'express';

/**
 * Gates the account-management surface (ADR-0037, ADR-0047): the `/users` routes. Must be layered
 * *after* {@link SessionAuthGuard}, which resolves the session to `req.user` — a missing session is
 * already a 401 by the time this runs. Superadmin supersedes every Instance Role (see
 * {@link canManageUsers}), so it passes too.
 */
@Injectable()
export class ManageUsersGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || !canManageUsers(user)) throw new ForbiddenException();
    return true;
  }
}

/**
 * Gates the Superadmin-only surfaces (ADR-0037, ADR-0047): the repair `/admin` routes and the
 * Superadmin-flag toggle. Stricter than {@link ManageUsersGuard}: a `manage-users` holder without
 * the Superadmin flag is a 403.
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user?.isSuperadmin) throw new ForbiddenException();
    return true;
  }
}
