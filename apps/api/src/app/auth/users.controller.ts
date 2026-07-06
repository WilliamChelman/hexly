import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { UserSummary } from '@hexly/domain';
import { DB, Db } from '../db/db';
import { users } from '../db/schema';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * The Instance user directory (#158). The owner-set UI needs to name an owner and
 * pick a co-Owner, but the closed user set is otherwise opaque to the web. This
 * exposes only id + displayName — never the email, which is private (ADR-0004).
 */
@Controller('users')
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(): UserSummary[] {
    return this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .all();
  }
}
