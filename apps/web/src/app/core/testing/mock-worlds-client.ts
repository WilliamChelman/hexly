import { Observable, of } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';

/**
 * A driveable stand-in for {@link WorldsClient}, the facade {@link WorldStore} and
 * the World Index depend on. Each method is a spy with a benign default; a spec
 * configures only what it exercises (`mock.list.mockReturnValue(of([world]))`) and
 * asserts the call. Keeps consumer tests on the facade boundary, off the TrailBase
 * wire (the mapping/composition is covered by `worlds.client.spec`).
 */
export class MockWorldsClient {
  list = vi.fn<() => Observable<WorldSummary[]>>(() => of([]));
  create = vi.fn<(name: string) => Observable<WorldDetail>>();
  get = vi.fn<(id: string) => Observable<WorldDetail>>();
  rename = vi.fn<(id: string, name: string) => Observable<WorldDetail>>();
  delete = vi.fn<(id: string) => Observable<void>>(() => of(undefined));
}
