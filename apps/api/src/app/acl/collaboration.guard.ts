import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HEXLY_CONFIG, type HexlyConfig } from '../config';

/**
 * Makes the Collaboration layer's routes **absent** — 404, not 403 — where `features.collaboration`
 * is off (ADR-0071), enforced at the route as ADR-0068 enforces at the write choke point.
 *
 * Never applied to `/auth/login` (auth, not Collaboration), `/admin/reindex` (ADR-0037 repair),
 * `GET /config`, or the Asset bytes route.
 */
@Injectable()
export class CollaborationGuard implements CanActivate {
  constructor(@Inject(HEXLY_CONFIG) private readonly config: HexlyConfig) {}

  canActivate(): boolean {
    if (!this.config.features.collaboration) throw new NotFoundException();
    return true;
  }
}
