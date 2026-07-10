import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ReindexJob } from '@hexly/domain';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SuperadminGuard } from './instance-admin.guard';
import { SuperadminService } from './superadmin.service';

/**
 * The Superadmin repair surface (ADR-0037, ADR-0046): routes that reach content, gated at the
 * class by {@link SuperadminGuard} behind the session guard. It sits apart from
 * {@link AdminController} rather than layering the stricter guard on one of its routes, because
 * the separation *is* the invariant: the Instance Admin surface has zero content powers, and a
 * route that walks every Entity in every World has no business standing among its account
 * management. An Instance Admin without the Superadmin flag is a 403 here.
 */
@Controller('superadmin')
@UseGuards(SessionAuthGuard, SuperadminGuard)
export class SuperadminController {
  constructor(private readonly superadmin: SuperadminService) {}

  /**
   * Start the Reindex (ADR-0046). A repair action, not part of daily administration.
   *
   * `202`, not `200`: the walk outlives this request. It returns the job in its `running` state
   * and the client follows it through {@link status} — the count is a promise the poll redeems,
   * rather than something this response could honestly report.
   *
   * `POST`, not `PUT`: it takes no body and names no resource, so it is not idempotent in HTTP's
   * sense of "the URL now holds what you sent". It *is* idempotent in the sense that matters to
   * the operator — pressing it twice changes nothing the first press did not. Pressing it twice
   * *while it runs* is a structured `409`: there is only ever one job.
   */
  @Post('reindex')
  @HttpCode(202)
  start(): ReindexJob {
    return this.superadmin.start();
  }

  /**
   * Where the instance's Reindex stands — the poll target the client follows a running walk with,
   * and the record of the last one to finish. Readable before any run has happened (`idle`).
   */
  @Get('reindex')
  status(): ReindexJob {
    return this.superadmin.status();
  }
}
