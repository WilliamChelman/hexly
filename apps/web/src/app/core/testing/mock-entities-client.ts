import { Observable, of } from 'rxjs';
import {
  EntityDetail,
  EntityPage,
  EntitySaveOutcome,
  EntityType,
} from '@hexly/domain';
import type { EntityListParams } from '../services/entities.client';

/**
 * A driveable stand-in for {@link EntitiesClient}, the facade consumers depend on
 * (guards, the entity session, the browser). Every method is a spy with a benign
 * default, so a spec configures only what it exercises —
 * `mock.load.mockReturnValue(of(detail))`, `mock.save.mockReturnValue(of(conflict))`,
 * a `Subject` for an in-flight save — and asserts the call (`expect(mock.save)…`).
 * This keeps consumer tests on the facade boundary instead of the TrailBase wire
 * (the mapping is covered by `entities.client.spec`).
 */
export class MockEntitiesClient {
  list = vi.fn<(opts?: EntityListParams) => Observable<EntityPage>>(() =>
    of({ items: [], nextCursor: null }),
  );
  load = vi.fn<(id: string) => Observable<EntityDetail>>();
  create = vi.fn<(name: string, type: EntityType, worldId?: string) => Observable<EntityDetail>>();
  rename = vi.fn<(id: string, name: string) => Observable<EntityDetail>>();
  delete = vi.fn<(id: string) => Observable<void>>(() => of(undefined));
  save = vi.fn<
    (
      id: string,
      body: unknown,
      version: number,
      tags: readonly string[],
      descriptors: readonly string[],
    ) => Observable<EntitySaveOutcome>
  >();
  listDescriptors = vi.fn<() => Observable<string[]>>(() => of([]));
}
