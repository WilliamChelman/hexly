import { Observable, of } from 'rxjs';
import {
  EntityBody,
  EntityDetail,
  EntityFacets,
  EntityPage,
  EntitySaveOutcome,
  EntityType,
} from '@hexly/domain';
import { EntityFacetParams, EntityListParams } from '../services/entities.client';

/** Spy-backed stand-in for {@link EntitiesClient} — set return values with `mockReturnValue`. */
export class MockEntitiesClient {
  list = vi.fn<(opts?: EntityListParams) => Observable<EntityPage>>();
  // Defaults to empty counts so a spec that doesn't care about the Facet rail
  // (#155) still renders without stubbing it; override per test as needed.
  facets = vi.fn<(opts?: EntityFacetParams) => Observable<EntityFacets>>(() =>
    of({ type: [], tag: [], visibility: [] }),
  );
  rename = vi.fn<(id: string, name: string) => Observable<EntityDetail>>();
  delete = vi.fn<(id: string) => Observable<void>>();
  create = vi.fn<
    (name: string, type: EntityType, worldId?: string) => Observable<EntityDetail>
  >();
  load = vi.fn<(id: string) => Observable<EntityDetail>>();
  listDescriptors = vi.fn<() => Observable<string[]>>();
  save = vi.fn<
    (
      id: string,
      body: EntityBody,
      version: number,
      tags: readonly string[],
    ) => Observable<EntitySaveOutcome>
  >();
}
