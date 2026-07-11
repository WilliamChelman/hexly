import { Observable, of } from 'rxjs';
import { ReindexJob } from '@hexly/domain';

/** A Reindex job in whatever state a spec needs; the rest of the shape is filled in. */
export function reindexJob(job: Partial<ReindexJob> = {}): ReindexJob {
  return {
    status: 'idle',
    total: 0,
    walked: 0,
    reindexed: 0,
    failures: [],
    startedAt: null,
    finishedAt: null,
    error: null,
    ...job,
  };
}

/** Test double for {@link AdminClient} — the Superadmin Reindex repair surface. */
export class MockAdminClient {
  reindex = vi.fn<() => Observable<ReindexJob>>(() => of(reindexJob({ status: 'running' })));
  reindexStatus = vi.fn<() => Observable<ReindexJob>>(() => of(reindexJob()));
}
