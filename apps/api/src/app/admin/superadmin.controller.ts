import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ReindexJob } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SuperadminGuard } from './instance-admin.guard';
import { SuperadminService } from './superadmin.service';

/**
 * Superadmin repair routes (ADR-0037, ADR-0046): content-reaching actions gated by
 * {@link SuperadminGuard}. Kept separate from {@link AdminController}, whose Instance
 * Admin surface has no content powers.
 */
@Controller('superadmin')
@UseGuards(SessionAuthGuard, SuperadminGuard)
export class SuperadminController {
  constructor(private readonly superadmin: SuperadminService) {}

  /** Start the Reindex (ADR-0046). 202: the walk outlives the request; 409 if one is already running. */
  @Post('reindex')
  @HttpCode(202)
  start(): ReindexJob {
    return this.superadmin.start();
  }

  /** Current Reindex state — poll target for a running walk, plus the last finished run. Readable when `idle`. */
  @Get('reindex')
  status(): ReindexJob {
    return this.superadmin.status();
  }
}
