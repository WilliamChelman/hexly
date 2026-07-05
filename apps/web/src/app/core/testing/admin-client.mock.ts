import { Observable, of } from 'rxjs';
import { AdminUser, CreateUserRequest } from '@hexly/domain';

/** Test double for {@link AdminClient} — every mutation resolves empty by default. */
export class MockAdminClient {
  list = vi.fn<() => Observable<AdminUser[]>>(() => of([]));
  createUser = vi.fn<(req: CreateUserRequest) => Observable<void>>(() => of(undefined));
  setDisabled = vi.fn<(id: string, disabled: boolean) => Observable<void>>(() => of(undefined));
  resetPassword = vi.fn<(id: string, password: string) => Observable<void>>(() => of(undefined));
  setAdmin = vi.fn<(id: string, isAdmin: boolean) => Observable<void>>(() => of(undefined));
  setSuperadmin = vi.fn<(id: string, isSuperadmin: boolean) => Observable<void>>(() => of(undefined));
  deleteUser = vi.fn<(id: string) => Observable<void>>(() => of(undefined));
}
