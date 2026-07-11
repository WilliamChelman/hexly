import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { canManageUsers } from '@hexly/domain';
import type { Request } from 'express';

/**
 * Gates the account-management surface (ADR-0037, ADR-0047): the `/users` routes.
 * Layered *after* {@link SessionAuthGuard} (which resolves the session to
 * `req.user`), so a missing session is already a 401 by the time this runs. A
 * signed-in user without the `manage-users` role is a 403. Superadmin supersedes
 * every Instance Role, so it passes too — the implication lives in the shared
 * {@link canManageUsers} helper, not inline here.
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
 * Gates the Superadmin-only surfaces (ADR-0037, ADR-0047): the repair `/admin`
 * routes and the Superadmin-flag toggle. Stricter than {@link ManageUsersGuard}:
 * a `manage-users` holder without the Superadmin flag is a 403, because the
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
