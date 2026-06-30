import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';
import type { FilterOrComposite, ListOpts } from 'trailbase';
import {
  ENTITY_LIST_DEFAULT_LIMIT,
  EntityBody,
  EntityDetail,
  EntityListQuery,
  EntityPage,
  EntitySaveOutcome,
  EntityType,
  emptyEntityBody,
} from '@hexly/domain';
import { TrailbaseClient } from './trailbase-client';
import { EntityRow } from '../models/entity-row';
import { toEntityDetail, toEntitySummary } from '../utils/tb-records';

/**
 * A save the version access-rule rejected: TrailBase answers a denied UPDATE with HTTP
 * 403 (its `FetchError` carries the numeric `status`, ADR-0032). 403 means a stale base
 * `version` here — the caller only saves Entities it owns and has open — so it maps to a
 * conflict. A malformed body trips the jsonschema CHECK as a 400 instead, which is a
 * client bug (zod is the write-path validator), so that propagates as an error.
 */
function isStaleWrite(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: unknown }).status === 403
  );
}

export type EntityListParams = Partial<EntityListQuery> & {
  /** Drop the World's Home Entity from the page — the library shows authored Entities, not the landing page. */
  excludeHome?: boolean;
};

/**
 * Owner-scoped reads/writes for Entities over the TrailBase `entities` Record API
 * (ADR-0032, ADR-0018). Stateless: every call is a round trip; open-entity state
 * lives in EntitySession. Access is enforced by the API's owner access-rules, so
 * this client carries no auth of its own — it talks through {@link TrailbaseClient}.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesClient {
  private readonly records = inject(TrailbaseClient).client.records<EntityRow>('entities');

  /** One page of the entities read surface (ADR-0025); `opts` filter and page it. */
  list(opts: EntityListParams = {}): Observable<EntityPage> {
    // An explicit empty id set selects nothing — short-circuit, never fetch-all.
    if (opts.ids && opts.ids.length === 0) return of({ items: [], nextCursor: null });

    const limit = opts.limit ?? ENTITY_LIST_DEFAULT_LIMIT;
    const filters: FilterOrComposite[] = [];
    if (opts.worldId) filters.push({ column: 'world_id', value: opts.worldId });
    if (opts.type) filters.push({ column: 'type', value: opts.type });
    if (opts.q) filters.push({ column: 'name', op: 'like', value: `%${opts.q}%` });
    if (opts.excludeHome) filters.push({ column: 'is_home', value: '0' });
    // Batch-by-id (the link picker / world-redirect guards) — an OR over equals.
    // An empty set selects nothing, never everything.
    if (opts.ids) filters.push({ or: opts.ids.map((id) => ({ column: 'id', value: id })) });

    const listOpts: ListOpts = {
      filters,
      order: ['-updated_at', '-id'],
      pagination: { limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) },
    };
    return from(this.records.list(listOpts)).pipe(
      map((res) => ({
        items: res.records.map(toEntitySummary),
        // TrailBase always returns a cursor; a short page means there's no next page.
        nextCursor: res.records.length === limit ? (res.cursor ?? null) : null,
      })),
    );
  }

  /** `worldId` scopes the new Entity to a World (ADR-0024); `owner_id` is autofilled from the caller. */
  create(name: string, type: EntityType, worldId?: string): Observable<EntityDetail> {
    return from(
      this.records.create({
        name,
        type,
        ...(worldId ? { world_id: worldId } : {}),
        document: JSON.stringify(emptyEntityBody(type)),
      } as unknown as EntityRow),
    ).pipe(switchMap((id) => this.load(String(id))));
  }

  load(id: string): Observable<EntityDetail> {
    return from(this.records.read(id)).pipe(map(toEntityDetail));
  }

  /** Metadata only — never conflicts with an in-progress save. */
  rename(id: string, name: string): Observable<EntityDetail> {
    return from(this.records.update(id, { name } as Partial<EntityRow>)).pipe(
      switchMap(() => this.load(id)),
    );
  }

  delete(id: string): Observable<void> {
    return from(this.records.delete(id)).pipe(map(() => undefined));
  }

  /**
   * Version-checked save (#130, ADR-0032): writes the body/tags under the base `version`
   * the caller last read, then re-reads the row. Optimistic concurrency is the entities
   * UPDATE access-rule `_REQ_.version = _ROW_.version` — so we send the *base*, not
   * `version + 1`; an `AFTER UPDATE` trigger advances the stored counter. A stale write
   * is rejected by TrailBase as a 403; rather than throw, we re-read and surface the
   * server's current state as a `conflict` for the session to re-pull from (the 403 has
   * no body — a subscribed client will already hold current state once realtime lands, #7).
   */
  save(
    id: string,
    body: EntityBody,
    version: number,
    tags: readonly string[],
    _descriptors: readonly string[],
  ): Observable<EntitySaveOutcome> {
    return from(
      this.records.update(id, {
        document: JSON.stringify(body),
        tags: JSON.stringify(tags),
        version,
      } as Partial<EntityRow>),
    ).pipe(
      switchMap(() => this.load(id)),
      map((entity): EntitySaveOutcome => ({ status: 'saved', entity })),
      catchError((err) =>
        isStaleWrite(err)
          ? this.load(id).pipe(
              map((current): EntitySaveOutcome => ({ status: 'conflict', current })),
            )
          : throwError(() => err),
      ),
    );
  }

  /**
   * The owner's Link Descriptor vocabulary (#96, ADR-0023). The descriptor index
   * is a separate surface not yet on TrailBase (slice #4/#5); until then there are
   * no `::` suggestions. ponytail: returns empty; wire to its Record API with save.
   */
  listDescriptors(): Observable<string[]> {
    return from(Promise.resolve<string[]>([]));
  }
}
