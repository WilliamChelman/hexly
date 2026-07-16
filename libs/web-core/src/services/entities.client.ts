import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
import {
  EntityDetail,
  EntityFacets,
  EntityGrant,
  EntityListQuery,
  EntityPage,
  EntityReferences,
  EntitySaveOutcome,
  EntityType,
  GrantRole,
  EntityDocument,
  PublicLink,
  Visibility,
} from '@hexly/domain';
import { NudgeBusClient } from './nudge-bus.client';
import { FollowStore } from './follow-store';
import { Watched } from './live-follow';

export type EntityListParams = Partial<EntityListQuery>;

/**
 * Trailing-debounce window before an incoming nudge is reconciled: a burst of rapid saves by
 * another user coalesces into a single refetch.
 */
export const ENTITY_NUDGE_DEBOUNCE_MS = 150;

/** The subset of list params the Facet-count read narrows against — no paging. */
export type EntityFacetParams = Pick<EntityListParams, 'q' | 'type' | 'tag' | 'visibility' | 'field' | 'worldId'>;

/**
 * HTTP client for the entities API.
 * Stateless: every call is a round trip; open-entity/conflict state lives in EntitySession.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesClient {
  private readonly http = inject(HttpClient);
  private readonly store = new FollowStore<EntityDetail>(inject(NudgeBusClient), {
    kind: 'entity',
    debounceMs: ENTITY_NUDGE_DEBOUNCE_MS,
  });

  /**
   * Live-follow one Entity through the write-through store (ADR-0044). Emits the fresh detail or
   * `EVICTED`; a consumer that shouldn't apply a given emission (e.g. an editor mid-edit) ignores it.
   */
  watch(id: string): Observable<Watched<EntityDetail>> {
    return this.store.watch(id, () => this.read(id));
  }

  list(opts: EntityListParams = {}): Observable<EntityPage> {
    let params = facetParams(opts);
    // `ids` repeats in query string; cursor/limit are single-valued paging.
    for (const id of opts.ids ?? []) params = params.append('ids', id);
    if (opts.cursor) params = params.set('cursor', opts.cursor);
    // An `ids` read is "resolve exactly these", not a paged browse: default the limit to
    // the id count (server clamps to ENTITY_LIST_MAX_LIMIT) so a set larger than the
    // default page size isn't silently truncated. An explicit limit still wins.
    const limit = opts.limit ?? (opts.ids?.length || undefined);
    if (limit !== undefined) params = params.set('limit', limit);
    // Opt-in per-row Rights; callers that omit it keep the server a pure read-filter
    // (no per-row EXISTS).
    if (opts.rights) params = params.set('rights', '1');
    return this.http.get<EntityPage>('/api/entities', { params });
  }

  /** Facet-rail counts under the active filters, drilled down server-side. */
  facets(opts: EntityFacetParams = {}): Observable<EntityFacets> {
    return this.http.get<EntityFacets>('/api/entities/facets', {
      params: facetParams(opts),
    });
  }

  /**
   * Patch an Entity's metadata — the `name` **or** the Visibility, never both (ADR-0045): they have
   * different write gates, and sending both is a 400. EntityDocument never conflicts with an in-progress save.
   */
  patch(id: string, changes: { name: string } | { visibility: Visibility }): Observable<EntityDetail> {
    // Write-through: the patched detail feeds the store, so other watchers see the rename/visibility
    // change with no roundtrip and this tab's own echo nudge dedups.
    return this.http.patch<EntityDetail>(`/api/entities/${id}`, changes).pipe(tap((d) => this.store.merge(d)));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/entities/${id}`);
  }

  /** The Entity's ownership set — Owner user ids. Owner-only server-side. */
  owners(id: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/entities/${id}/owners`);
  }

  /** Add a co-Owner; returns the updated set. Idempotent (200), not a create. */
  addOwner(id: string, userId: string): Observable<string[]> {
    return this.http.post<string[]>(`/api/entities/${id}/owners`, { userId });
  }

  /** Remove an Owner or resign your own ownership; returns the updated set. */
  removeOwner(id: string, userId: string): Observable<string[]> {
    return this.http.delete<string[]>(`/api/entities/${id}/owners/${userId}`);
  }

  /** The Entity's grant set — named Editor/Viewer grants. Owner-only server-side. */
  grants(id: string): Observable<EntityGrant[]> {
    return this.http.get<EntityGrant[]>(`/api/entities/${id}/grants`);
  }

  /** Grant an Instance user Editor or Viewer; returns the updated set. Upsert (200), not a create. */
  addGrant(id: string, userId: string, role: GrantRole): Observable<EntityGrant[]> {
    return this.http.post<EntityGrant[]>(`/api/entities/${id}/grants`, {
      userId,
      role,
    });
  }

  /** Revoke a grant; returns the updated set. */
  removeGrant(id: string, userId: string): Observable<EntityGrant[]> {
    return this.http.delete<EntityGrant[]>(`/api/entities/${id}/grants/${userId}`);
  }

  /** The Entity's per-entity Public Link — the active token or null. Owner-only server-side. */
  link(id: string): Observable<PublicLink | null> {
    return this.http.get<PublicLink | null>(`/api/entities/${id}/link`);
  }

  /** Mint (or return the existing) per-entity Public Link; idempotent (200). */
  mintLink(id: string): Observable<PublicLink> {
    return this.http.post<PublicLink>(`/api/entities/${id}/link`, {});
  }

  /** Revoke the per-entity Public Link — the kill-switch. */
  revokeLink(id: string): Observable<void> {
    return this.http.delete<void>(`/api/entities/${id}/link`);
  }

  /**
   * Create an Entity with an ordered `types` set, `types[0]` primary (ADR-0048). `doc` seeds a
   * picked type's required Fields into the minted body. worldId omitted → the caller's first World.
   */
  create(name: string, types: readonly EntityType[], worldId?: string, doc?: EntityDocument): Observable<EntityDetail> {
    return this.http.post<EntityDetail>('/api/entities', {
      name,
      types,
      ...(worldId ? { worldId } : {}),
      ...(doc ? { document: doc } : {}),
    });
  }

  /** Raw read — the store's own refetch source (the store seeds its held from it directly). */
  private read(id: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/api/entities/${id}`);
  }

  // Write-through: a load seeds the store's held version, so the first nudge after opening dedups a
  // self-echo, and fans the fresh detail to any other watcher.
  load(id: string): Observable<EntityDetail> {
    return this.read(id).pipe(tap((d) => this.store.merge(d)));
  }

  /**
   * Both directions of one Entity's links, off the derived edge index (ADR-0046). Resolved for the
   * caller: an inbound edge whose source they may not read is already absent, and an outbound
   * target they may not read arrives with `target: null` — the dangling case.
   */
  references(id: string): Observable<EntityReferences> {
    return this.http.get<EntityReferences>(`/api/entities/${id}/references`);
  }

  // Owner's Link Descriptor vocabulary — DISTINCT, last-saved state.
  listDescriptors(): Observable<string[]> {
    return this.http.get<string[]>('/api/entities/descriptors');
  }

  // Owner's Tag suggestion vocabulary — DISTINCT across their entities.
  listTags(): Observable<string[]> {
    return this.http.get<string[]>('/api/entities/tags');
  }

  /**
   * Stale base → `conflict` outcome, not a thrown error; caller branches, not catches. `types` is
   * sent only when the session authored the type set (an active typed edit the server gates its
   * Fields forward-only); a plain document edit omits it, so data at rest is never re-typed (ADR-0048).
   * `fields` — the directly-attached Field ids (ADR-0054) — rides the same rule: sent only when the
   * session authored an attach/detach, omitted otherwise so the stored set is left untouched.
   */
  save(
    id: string,
    doc: EntityDocument,
    version: number,
    tags: readonly string[],
    types?: readonly EntityType[],
    fields?: readonly string[],
  ): Observable<EntitySaveOutcome> {
    return this.http
      .put<EntityDetail>(`/api/entities/${id}`, {
        document: doc,
        version,
        tags,
        ...(types !== undefined && { types }),
        ...(fields !== undefined && { fields }),
      })
      .pipe(
        // Write-through: a clean save is the freshest state — feed it to the store so other watchers
        // see it and this tab's echo nudge dedups.
        tap((saved) => this.store.merge(saved)),
        map((saved): EntitySaveOutcome => ({ status: 'saved', entity: saved })),
        catchError((err: unknown) => {
          // A 409 means the base version moved: report the server's Entity as a
          // conflict. Guard that the body is actually an Entity — a non-JSON 409
          // (e.g. a proxy's HTML error page) falls through to the error path.
          if (
            err instanceof HttpErrorResponse &&
            err.status === 409 &&
            err.error !== null &&
            typeof err.error === 'object'
          ) {
            const current = err.error as EntityDetail;
            // The server's newer version is authoritative — write it through too, so watchers reconcile.
            this.store.merge(current);
            return of<EntitySaveOutcome>({ status: 'conflict', current });
          }
          return throwError(() => err);
        }),
      );
  }
}

/**
 * `type`/`tag`/`visibility` each repeat in the query string (`?tag=a&tag=b`, OR within category);
 * `q`/`worldId` are single-valued.
 */
function facetParams(opts: EntityFacetParams): HttpParams {
  let params = new HttpParams();
  if (opts.q) params = params.set('q', opts.q);
  for (const t of opts.type ?? []) params = params.append('type', t);
  for (const t of opts.tag ?? []) params = params.append('tag', t);
  for (const v of opts.visibility ?? []) params = params.append('visibility', v);
  // Filter-by-Field: each `key:op:value` token repeats, like the other facet params.
  for (const f of opts.field ?? []) params = params.append('field', f);
  if (opts.worldId) params = params.set('worldId', opts.worldId);
  return params;
}
