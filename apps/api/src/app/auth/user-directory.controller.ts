import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { UserSummary } from '@hexly/domain';
import { CollaborationGuard } from '../acl/collaboration.guard';
import { DB, Db } from '../db/db';
import { users } from '../db/schema';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * The Instance user directory: id + displayName only — never the email, which is
 * private (ADR-0004). Readable by any signed-in user.
 *
 * Distinct from the role-gated `manage-users` account surface at `/users`
 * (ADR-0047).
 *
 * It exists only to populate the share dialogs' people pickers, so it is Collaboration entire
 * (ADR-0071): absent where the layer is off.
 */
@Controller('users/directory')
@UseGuards(CollaborationGuard, SessionAuthGuard)
export class UserDirectoryController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(): UserSummary[] {
    return this.db.select({ id: users.id, displayName: users.displayName }).from(users).all();
  }
}
