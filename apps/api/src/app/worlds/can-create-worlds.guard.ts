import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { canCreateWorlds } from '@hexly/domain';
import type { Request } from 'express';

/**
 * Gates the World-minting routes (ADR-0040, ADR-0047): a caller must hold the
 * `create-worlds` Instance Role. Layered *after* {@link SessionAuthGuard} (which resolves
 * the session to `req.user`), so a missing session is already a 401 by the time this runs;
 * a signed-in user without the role is a 403. Reads the roles off the already-loaded session
 * user — no DB hit. Superadmin always may create (repair, ADR-0037): the implication lives in
 * the shared {@link canCreateWorlds} helper.
 */
@Injectable()
export class CanCreateWorldsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || !canCreateWorlds(user)) throw new ForbiddenException();
    return true;
  }
}
