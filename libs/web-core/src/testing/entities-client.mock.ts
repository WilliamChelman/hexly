import { NEVER, Observable, of } from 'rxjs';
import {
  EntityDetail,
  EntityFacets,
  EntityGrant,
  EntityPage,
  EntityReferences,
  EntitySaveOutcome,
  EntityType,
  GrantRole,
  EntityDocument,
  PublicLink,
} from '@hexly/domain';
import { EntityFacetParams, EntityListParams } from '../services/entities.client';
import { Watched } from '../services/live-follow';

/** Spy-backed stand-in for {@link EntitiesClient} — set return values with `mockReturnValue`. */
export class MockEntitiesClient {
  list = vi.fn<(opts?: EntityListParams) => Observable<EntityPage>>();
  // Live-follow seam defaults to a silent stream so a consumer that follows on construction doesn't
  // crash; a spec exercising live-follow overrides the impl to push Watched values (see the specs).
  watch = vi.fn<(id: string) => Observable<Watched<EntityDetail>>>(() => NEVER);
  // Defaults to empty counts so a spec that doesn't care about the Facet rail
  // (#155) still renders without stubbing it; override per test as needed.
  facets = vi.fn<(opts?: EntityFacetParams) => Observable<EntityFacets>>(() =>
    of({ type: [], tag: [], visibility: [], fields: [] }),
  );
  patch =
    vi.fn<
      (id: string, changes: { name?: string; visibility?: EntityDetail['visibility'] }) => Observable<EntityDetail>
    >();
  delete = vi.fn<(id: string) => Observable<void>>();
  // Defaults to no links so the usage-aware delete confirmation (ADR-0065) renders its plain prompt
  // without stubbing; override per test to exercise the referencing-Entities list.
  references = vi.fn<(id: string) => Observable<EntityReferences>>(() =>
    of<EntityReferences>({ references: [], referencedBy: [] }),
  );
  create =
    vi.fn<
      (name: string, types: readonly EntityType[], worldId?: string, doc?: EntityDocument) => Observable<EntityDetail>
    >();
  load = vi.fn<(id: string) => Observable<EntityDetail>>();
  listDescriptors = vi.fn<() => Observable<string[]>>();
  // Defaults to an empty vocabulary so a spec that drives the tag input (EntityTags.suggest)
  // doesn't throw on an unstubbed listTags; override per test as needed.
  listTags = vi.fn<() => Observable<string[]>>(() => of<string[]>([]));
  save =
    vi.fn<
      (
        id: string,
        doc: EntityDocument,
        version: number,
        tags: readonly string[],
        types?: readonly EntityType[],
        fields?: readonly string[],
      ) => Observable<EntitySaveOutcome>
    >();
  // Defaults to an empty set so a spec that mounts the owner-set panel without
  // caring about it still renders; override per test as needed.
  owners = vi.fn<(id: string) => Observable<string[]>>(() => of<string[]>([]));
  addOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
  removeOwner = vi.fn<(id: string, userId: string) => Observable<string[]>>();
  // Defaults to an empty set so a spec that mounts the grant-set panel (#161) without
  // caring about it still renders; override per test as needed.
  grants = vi.fn<(id: string) => Observable<EntityGrant[]>>(() => of<EntityGrant[]>([]));
  addGrant = vi.fn<(id: string, userId: string, role: GrantRole) => Observable<EntityGrant[]>>();
  removeGrant = vi.fn<(id: string, userId: string) => Observable<EntityGrant[]>>();
  // Defaults to no active link so a spec mounting the Public Link control (#162) without
  // caring about it still renders; override per test as needed.
  link = vi.fn<(id: string) => Observable<PublicLink | null>>(() => of<PublicLink | null>(null));
  mintLink = vi.fn<(id: string) => Observable<PublicLink>>();
  revokeLink = vi.fn<(id: string) => Observable<void>>();
}
