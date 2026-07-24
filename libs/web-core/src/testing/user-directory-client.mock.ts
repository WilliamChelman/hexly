import { Observable, of } from 'rxjs';
import { UserSummary } from '@hexly/domain';

/** Spy-backed stand-in for {@link UserDirectoryClient}. Defaults to an empty directory. */
export class MockUserDirectoryClient {
  list = vi.fn<() => Observable<UserSummary[]>>(() => of<UserSummary[]>([]));
}
