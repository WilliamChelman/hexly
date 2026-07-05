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
  patch =
    vi.fn<
      (
        id: string,
        changes: { name?: string; visibility?: EntityDetail['visibility'] },
      ) => Observable<EntityDetail>
    >();
  delete = vi.fn<(id: string) => Observable<void>>();
  create = vi.fn<
    (name: string, type: EntityType, worldId?: string) => Observable<EntityDetail>
  >();
  load = vi.fn<(id: string) => Observable<EntityDetail>>();
  listDescriptors = vi.fn<() => Observable<string[]>>();
  // Defaults to an empty vocabulary so a spec that drives the tag input (EntityTags.suggest)
  // doesn't throw on an unstubbed listTags; override per test as needed.
  listTags = vi.fn<() => Observable<string[]>>(() => of<string[]>([]));
  save = vi.fn<
    (
      id: string,
      body: EntityBody,
      version: number,
      tags: readonly string[],
    ) => Observable<EntitySaveOutcome>
  >();
  // Defaults to an empty set so a spec that mounts the owner-set panel without
  // caring about it still renders; override per test as needed.
  owners = vi.fn<(id: string) => Observable<string[]>>(() => of<string[]>([]));
  addOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
  removeOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
}
