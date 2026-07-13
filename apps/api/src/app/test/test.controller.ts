import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DB, Db } from '../db/db';
import { entities, users } from '../db/schema';

/**
 * E2E-only test support: returns the database to a known baseline between browser tests. Mounted
 * only when {@link AppModule} opts in (`HEXLY_E2E=1` and not production), so it is absent from a
 * real deploy (ADR-0009).
 *
 * This route is INTENTIONALLY unauthenticated (no `SessionAuthGuard`, unlike every other
 * controller): the reset must run with an empty session, from the logged-out auth journey.
 */
@Controller('test')
export class TestController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Reset to a clean slate: delete every Entity, and clear the Preferences on the user row
   * (ADR-0038). Users and sessions survive, so an established e2e session outlives the reset.
   *
   * Preferences are server-persisted and hydrated on boot, so they must be cleared too: a test that
   * flips the UI language would otherwise leave the account in French for every test after it.
   */
  @Post('reset')
  @HttpCode(204)
  reset(): void {
    // A fixture reset, not a domain write: no EntityWrites nudge is needed (ADR-0045).
    // eslint-disable-next-line hexly-writes/no-direct-entity-writes
    this.db.delete(entities).run();
    this.db.update(users).set({ preferences: '{}' }).run();
  }
}
