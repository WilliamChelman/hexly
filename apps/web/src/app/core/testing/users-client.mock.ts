import { Observable, of } from 'rxjs';
import { UserSummary } from '@hexly/domain';

/** Spy-backed stand-in for {@link UsersClient}. Defaults to an empty directory. */
export class MockUsersClient {
  list = vi.fn<() => Observable<UserSummary[]>>(() => of<UserSummary[]>([]));
}
