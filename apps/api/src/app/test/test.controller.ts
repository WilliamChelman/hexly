import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DB, Db } from '../db/db';
import { entities, users, worldFields, worldTypes } from '../db/schema';

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
   * Reset to a clean slate: delete every Entity and every World-authored Type and Field, and clear
   * the Preferences on the user row (ADR-0038). Users, sessions, and Worlds survive, so an
   * established e2e session — and the seeded starter World the Index lands on — outlive the reset.
   *
   * World Types and Fields are cleared for the same reason Entities are: they are World-scoped
   * authored data (ADR-0054), and a spec that authors `world.deity` would otherwise leave it for the
   * next spec to trip over — the run is serial over one shared DB, so authored ids accumulate.
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
    this.db.delete(worldTypes).run();
    this.db.delete(worldFields).run();
    this.db.update(users).set({ preferences: '{}' }).run();
  }
}
