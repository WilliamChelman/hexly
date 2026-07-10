import { Observable, of } from 'rxjs';
import { AdminUser, CreateUserRequest, ReindexJob } from '@hexly/domain';

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

/** Test double for {@link AdminClient} — every mutation resolves empty by default. */
export class MockAdminClient {
  list = vi.fn<() => Observable<AdminUser[]>>(() => of([]));
  createUser = vi.fn<(req: CreateUserRequest) => Observable<void>>(() => of(undefined));
  setDisabled = vi.fn<(id: string, disabled: boolean) => Observable<void>>(() => of(undefined));
  resetPassword = vi.fn<(id: string, password: string) => Observable<void>>(() => of(undefined));
  setAdmin = vi.fn<(id: string, isAdmin: boolean) => Observable<void>>(() => of(undefined));
  setCanCreateWorlds = vi.fn<(id: string, canCreateWorlds: boolean) => Observable<void>>(() => of(undefined));
  setSuperadmin = vi.fn<(id: string, isSuperadmin: boolean) => Observable<void>>(() => of(undefined));
  deleteUser = vi.fn<(id: string) => Observable<void>>(() => of(undefined));
  reindex = vi.fn<() => Observable<ReindexJob>>(() => of(reindexJob({ status: 'running' })));
  reindexStatus = vi.fn<() => Observable<ReindexJob>>(() => of(reindexJob()));
}
