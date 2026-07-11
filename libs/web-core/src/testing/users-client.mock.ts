import { Observable, of } from 'rxjs';
import { CreateUserRequest, InstanceRole, UserAccount } from '@hexly/domain';

/** Test double for {@link UsersClient} — every mutation resolves empty by default. */
export class MockUsersClient {
  list = vi.fn<() => Observable<UserAccount[]>>(() => of([]));
  createUser = vi.fn<(req: CreateUserRequest) => Observable<void>>(() => of(undefined));
  setDisabled = vi.fn<(id: string, disabled: boolean) => Observable<void>>(() => of(undefined));
  resetPassword = vi.fn<(id: string, password: string) => Observable<void>>(() => of(undefined));
  setRoles = vi.fn<(id: string, roles: readonly InstanceRole[]) => Observable<void>>(
    () => of(undefined),
  );
  setSuperadmin = vi.fn<(id: string, isSuperadmin: boolean) => Observable<void>>(() => of(undefined));
  deleteUser = vi.fn<(id: string) => Observable<void>>(() => of(undefined));
}
