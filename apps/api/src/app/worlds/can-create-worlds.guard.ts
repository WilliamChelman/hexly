import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Gates the World-minting routes (ADR-0040): a caller must hold the World Creation
 * capability. Layered *after* {@link SessionAuthGuard} (which resolves the session to
 * `req.user`), so a missing session is already a 401 by the time this runs; a signed-in
 * user without the capability is a 403. Reads the flag off the already-loaded session
 * user — no DB hit. Superadmin always may create (repair, ADR-0037), regardless of the flag.
 */
@Injectable()
export class CanCreateWorldsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user?.canCreateWorlds && !user?.isSuperadmin)
      throw new ForbiddenException();
    return true;
  }
}
