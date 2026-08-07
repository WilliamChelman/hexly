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
  LocalGraph,
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
export type EntityFacetParams = Pick<
  EntityListParams,
  | 'q'
  | 'type'
  | 'tag'
  | 'visibility'
  | 'field'
  | 'worldId'
  | 'containerId'
  | 'container'
  | 'read'
  | 'includeHidden'
  // The excluding half of each category (ADR-0081). On the Facet read too: the counts drill down
  // against every other active constraint, and an exclusion is one.
  | 'excludeType'
  | 'excludeTag'
  | 'excludeVisibility'
  | 'excludeContainer'
>;

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
    // Opt-in per-row thumbnail URL (ADR-0065/0066); the Asset and Entity Browsers set it, so lists that
    // render no tiles skip the resolution join.
    if (opts.thumbnails) params = params.set('thumbnails', '1');
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
   * `tags` is the Tag set to mint with — Inline Creation's `entities.inlineTag` (ADR-0073).
   */
  create(
    name: string,
    types: readonly EntityType[],
    worldId?: string,
    doc?: EntityDocument,
    tags?: readonly string[],
  ): Observable<EntityDetail> {
    return this.http.post<EntityDetail>('/api/entities', {
      name,
      types,
      ...(worldId ? { worldId } : {}),
      ...(doc ? { document: doc } : {}),
      ...(tags?.length ? { tags } : {}),
    });
  }

  /**
   * **Adopt** a **Compendium Entry** into `worldId` (CONTEXT.md → Adoption). Not written through the
   * follow store: nothing can be watching an Entity that did not exist a moment ago, and the entry it
   * was copied from is untouched.
   */
  adopt(id: string, worldId: string): Observable<EntityDetail> {
    return this.http.post<EntityDetail>(`/api/entities/${id}/adopt`, { worldId });
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

  /**
   * This Entity's **Local Graph** (ADR-0072) — the World Graph narrowed to its neighbourhood, `depth`
   * hops out. Server-bounded, so the payload stays proportional to the neighbourhood rather than to the
   * World; a depth change is therefore a refetch, not a client-side filter.
   */
  localGraph(id: string, depth: number): Observable<LocalGraph> {
    return this.http.get<LocalGraph>(`/api/entities/${id}/graph`, {
      params: new HttpParams().set('depth', depth),
    });
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
   * Attached Fields ride the document itself (ADR-0057) — a directly-attached Field is a namespaced key
   * the document carries that no type defaults — so there is no separate attachment set to send.
   */
  save(
    id: string,
    doc: EntityDocument,
    version: number,
    tags: readonly string[],
    types?: readonly EntityType[],
  ): Observable<EntitySaveOutcome> {
    return this.http
      .put<EntityDetail>(`/api/entities/${id}`, {
        document: doc,
        version,
        tags,
        ...(types !== undefined && { types }),
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
  // Each category's excluding twin, repeating the same way (ADR-0081); a Field's exclusion instead
  // rides `field`'s own `neq` op, so it needs no param of its own.
  for (const t of opts.excludeType ?? []) params = params.append('excludeType', t);
  for (const t of opts.excludeTag ?? []) params = params.append('excludeTag', t);
  for (const v of opts.excludeVisibility ?? []) params = params.append('excludeVisibility', v);
  for (const c of opts.excludeContainer ?? []) params = params.append('excludeContainer', c);
  // Filter-by-Field: each `key:op:value` token repeats, like the other facet params.
  for (const f of opts.field ?? []) params = params.append('field', f);
  if (opts.worldId) params = params.set('worldId', opts.worldId);
  // The Container scope a cross-Container read names explicitly (ADR-0079, ADR-0080) — the Library's
  // Mounts, in the Owner's order, which the server reads back — and, separately, the Container facet's
  // selection within it.
  for (const c of opts.containerId ?? []) params = params.append('containerId', c);
  for (const c of opts.container ?? []) params = params.append('container', c);
  // A link-target read declares itself; a navigation read is the server's default, so it stays off the
  // wire (ADR-0079). On both reads, so a rail's counts and its options agree about Compendium Entries.
  if (opts.read && opts.read !== 'navigation') params = params.set('read', opts.read);
  // Opt-in to hidden-from-default-listing types (ADR-0065) — set by the by-name pickers, not by a browse.
  // On both reads, so a rail's counts and its list agree about them.
  if (opts.includeHidden) params = params.set('includeHidden', '1');
  return params;
}
