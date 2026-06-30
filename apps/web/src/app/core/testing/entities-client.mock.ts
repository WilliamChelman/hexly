import { Observable } from 'rxjs';
import {
  EntityBody,
  EntityDetail,
  EntityPage,
  EntitySaveOutcome,
  EntityType,
} from '@hexly/domain';
import { EntityListParams } from '../services/entities.client';

/** Spy-backed stand-in for {@link EntitiesClient} — set return values with `mockReturnValue`. */
export class MockEntitiesClient {
  list = vi.fn<(opts?: EntityListParams) => Observable<EntityPage>>();
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
      descriptors: readonly string[],
    ) => Observable<EntitySaveOutcome>
  >();
}
