import { DestroyRef, Injectable, WritableSignal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, firstValueFrom, map, share } from 'rxjs';
import { ENTITY_LIST_MAX_LIMIT, EntitySummary } from '@hexly/domain';
import { EntitiesClient, EntityListParams, searchEntities } from '@hexly/web-core';

/** A link's resolution against the owner's entities (issue #95, ADR-0023). */
export type EntityResolution =
  | { status: 'loading' }
  | { status: 'found'; entity: EntitySummary }
  | { status: 'missing' };

/**
 * Shared id→name resolver for Entity Links in notes (ADR-0023). Resolves targets'
 * live names: renamed targets reflect automatically, deleted ones resolve to `missing`.
 * Fetches only referenced ids (one chunked `list({ ids })` per render). The `@`
 * picker searches the server directly via {@link search}.
 * Provided per note surface for a fresh cache on navigation.
 */
@Injectable()
export class EntityNameResolver {
  private readonly client = inject(EntitiesClient);
  protected readonly destroyRef = inject(DestroyRef);

  // One signal per requested id, created on first resolve and filled when its batch lands.
  private readonly cache = new Map<string, WritableSignal<EntityResolution>>();
  // Ids awaiting the next flush, coalesced into one request.
  private readonly pending = new Set<string>();
  private flushQueued = false;

  /** Resolve an id to its live name. Reactive: re-reads when its batch lands. */
  resolve(id: string): EntityResolution {
    let entry = this.cache.get(id);
    if (!entry) {
      entry = signal<EntityResolution>({ status: 'loading' });
      this.cache.set(id, entry);
      this.pending.add(id);
      this.scheduleFlush();
    }
    return entry();
  }

  // Picker's live query stream, shared so overlapping awaits collapse onto one debounced search.
  private readonly pickerQuery$ = new Subject<string>();
  // Owned here, not left inside the stream, so {@link forgetSearches} can drop it.
  private readonly searchCache = new Map<string, EntitySummary[]>();
  /** The World the next request scopes to — read back when the debounced search fires. */
  private worldId: string | undefined;
  /**
   * What the pending query's **Facet Tokens** mean as list params (ADR-0082), read back when the
   * debounced search fires, as `worldId` is. Memoised beside it safely because the *raw* box keys the
   * cache: two queries that spell the same tokens parse alike, and two that do not never share an entry.
   */
  private filters: EntityListParams = {};
  private readonly pickerResults$ = searchEntities(this.client, this.pickerQuery$, {
    cache: this.searchCache,
    // A link-target read (ADR-0079) in the host Entity's World — the World a mention mints into, never
    // the URL's (ADR-0073) — so typing a name reaches that World's Entities and the ones in the
    // Containers it Mounts, which is the whole of what it may point at (ADR-0080). The typed Facets ride
    // here too, `q` among them: the wire carries the residual text, never the raw box (ADR-0082).
    params: () => ({ read: 'link-target', ...(this.worldId ? { worldId: this.worldId } : {}), ...this.filters }),
  }).pipe(share());

  /**
   * The Entities `query` names that this note may link — server-filtered (ADR-0025 `q`) under whatever
   * `filters` its Facet Tokens named, scoped to `worldId` and what it Mounts. `@tiptap/suggestion` awaits
   * this per keystroke; the shared search debounces the burst and a failed search yields an empty list
   * rather than rejecting the popup. `query` is the box exactly as typed — what the memo keys on.
   */
  search(query: string, worldId?: string, filters: EntityListParams = {}): Promise<EntitySummary[]> {
    this.filters = filters;
    // A different World is a different set of answers, and the memo keys on the query alone — so drop it
    // rather than rely on one resolver only ever serving one host (the right dock shares this instance).
    if (worldId !== this.worldId) this.forgetSearches();
    this.worldId = worldId;
    // Subscribe before pushing so the live search catches this query.
    const result = firstValueFrom(this.pickerResults$);
    this.pickerQuery$.next(query);
    return result;
  }

  /**
   * Forget the memoised searches. {@link search} takes the first emission, so a repeated query paints
   * the cache and never revalidates — the miss that offered `Create "Zorblax"` would otherwise answer
   * the *next* `@Zorblax` and the two mentions would not converge (ADR-0073). All of them, not the one
   * name: every prefix typed on the way to it cached the same miss.
   */
  forgetSearches(): void {
    this.searchCache.clear();
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  // Batch queued ids into chunked fetches, then fill each id's signal.
  private flush(): void {
    this.flushQueued = false;
    const ids = [...this.pending];
    this.pending.clear();
    for (let i = 0; i < ids.length; i += ENTITY_LIST_MAX_LIMIT) {
      const chunk = ids.slice(i, i + ENTITY_LIST_MAX_LIMIT);
      this.fetchByIds(chunk)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (items) => this.fill(chunk, items),
          // Failed batch resolves ids to missing (dangling).
          error: () => this.fill(chunk, []),
        });
    }
  }

  /**
   * Fetch summaries for one batch of ids — the only server dependency of the id→name
   * resolution. Overridden by the Public Link page to read the token-scoped public surface
   * instead of the session-guarded `/api/entities` (ADR-0037).
   */
  protected fetchByIds(ids: string[]): Observable<EntitySummary[]> {
    return this.client.list({ ids }).pipe(map((page) => page.items));
  }

  private fill(ids: string[], items: EntitySummary[]): void {
    const byId = new Map(items.map((e) => [e.id, e]));
    for (const id of ids) {
      const entity = byId.get(id);
      this.cache.get(id)?.set(entity ? { status: 'found', entity } : { status: 'missing' });
    }
  }
}
