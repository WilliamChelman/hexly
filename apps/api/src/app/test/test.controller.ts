import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DB, Db } from '../db/db';
import { entities } from '../db/schema';

/**
 * E2E-only test support. This controller is mounted only when {@link AppModule}
 * opts in (`HEXLY_E2E=1` and not production), so it is physically absent from a
 * real deploy — see ADR-0009. It exists so the browser suite can return the
 * database to a known baseline between tests.
 *
 * This route is INTENTIONALLY unauthenticated (no `SessionAuthGuard`, unlike
 * every other controller) so the e2e reset can run before/around login —
 * including from the logged-out auth journey. Adding a guard here would break
 * `apps/web-e2e/src/auth.spec.ts`, which resets with an empty session. This is
 * safe because the whole module is only mounted under the e2e opt-in (ADR-0009).
 */
@Controller('test')
export class TestController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Reset to a clean slate: delete every Entity. Users and sessions are left
   * intact on purpose, so an already-established e2e session survives the reset
   * (ADR-0009 — entities-only reset).
   */
  @Post('reset')
  @HttpCode(204)
  reset(): void {
    this.db.delete(entities).run();
  }
}
