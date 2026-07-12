import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DB, Db } from '../db/db';
import { entities, users } from '../db/schema';

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
   * Reset to a clean slate: delete every Entity, and clear the Preferences on the user row
   * (ADR-0038). Users and sessions themselves survive, so an established e2e session outlives the
   * reset (ADR-0009).
   *
   * The Preferences go with the Entities because they are server-persisted and hydrated on boot: a
   * test that flips the UI language would otherwise leave the *account* in French, and every test
   * after it would load a French app and miss its English selectors.
   */
  @Post('reset')
  @HttpCode(204)
  reset(): void {
    // Deliberately not routed through EntityWrites (ADR-0045): this is a fixture reset, not a
    // domain write. There is nothing to nudge — the e2e browser reloads after it — and this
    // module is physically absent from a real deploy (ADR-0009).
    // eslint-disable-next-line hexly-writes/no-direct-entity-writes
    this.db.delete(entities).run();
    this.db.update(users).set({ preferences: '{}' }).run();
  }
}
