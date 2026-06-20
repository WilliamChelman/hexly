import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DB, Db } from '../db/db';
import { maps } from '../db/schema';

/**
 * E2E-only test support. This controller is mounted only when {@link AppModule}
 * opts in (`HEXLY_E2E=1` and not production), so it is physically absent from a
 * real deploy — see ADR-0009. It exists so the browser suite can return the
 * database to a known baseline between tests.
 */
@Controller('test')
export class TestController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Reset to a clean slate: delete every Hex Map. Users and sessions are left
   * intact on purpose, so an already-established e2e session survives the reset
   * (ADR-0009 — maps-only reset).
   */
  @Post('reset')
  @HttpCode(204)
  reset(): void {
    this.db.delete(maps).run();
  }
}
