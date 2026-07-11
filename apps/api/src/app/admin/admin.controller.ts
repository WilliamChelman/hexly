import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ReindexJob } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SuperadminGuard } from './manage-users.guard';
import { AdminService } from './admin.service';

/**
 * The Superadmin operator surface (ADR-0037, ADR-0046, ADR-0047): the `/admin` repair
 * routes, content-reaching, gated by {@link SuperadminGuard}. Reindex is its first tool.
 * Named for the surface (`admin`), not the flag (`superadmin`), so an Instance Role could
 * be granted access here later without a rename. Kept separate from {@link UsersController},
 * whose `manage-users` surface has no content powers.
 */
@Controller('admin')
@UseGuards(SessionAuthGuard, SuperadminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Start the Reindex (ADR-0046). 202: the walk outlives the request; 409 if one is already running. */
  @Post('reindex')
  @HttpCode(202)
  start(): ReindexJob {
    return this.admin.start();
  }

  /** Current Reindex state — poll target for a running walk, plus the last finished run. Readable when `idle`. */
  @Get('reindex')
  status(): ReindexJob {
    return this.admin.status();
  }
}
