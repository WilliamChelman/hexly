import { Observable, of } from 'rxjs';
import { ImportSummary, WorldDetail, WorldSummary } from '@hexly/domain';

/** Spy-backed stand-in for {@link WorldsClient} — set return values with `mockReturnValue`. */
export class MockWorldsClient {
  list = vi.fn<() => Observable<WorldSummary[]>>();
  create = vi.fn<(name: string) => Observable<WorldDetail>>();
  importVault = vi.fn<(file: File) => Observable<ImportSummary>>();
  exportVault = vi.fn<(id: string) => Observable<Blob>>();
  get = vi.fn<(id: string) => Observable<WorldDetail>>();
  rename = vi.fn<(id: string, name: string) => Observable<WorldDetail>>();
  delete = vi.fn<(id: string) => Observable<void>>();
  // Defaults to an empty set so a spec that mounts the owner-set panel without
  // caring about it still renders; override per test as needed.
  owners = vi.fn<(id: string) => Observable<string[]>>(() => of<string[]>([]));
  addOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
  removeOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
}
