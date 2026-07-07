import {
  DestroyRef,
  Injectable,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, firstValueFrom, map, share } from 'rxjs';
import { ENTITY_LIST_MAX_LIMIT, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { searchEntities } from '../../../core/utils/search-entities';

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
  private readonly pickerResults$ = searchEntities(
    this.client,
    this.pickerQuery$,
  ).pipe(share());

  /**
   * The owner's entities matching `query`, server-filtered (ADR-0025 `q`) — the
   * `@` picker's source. `@tiptap/suggestion` awaits this per keystroke; the
   * shared search debounces the burst and a failed search yields an empty list
   * rather than rejecting the popup.
   */
  search(query: string): Promise<EntitySummary[]> {
    // Subscribe before pushing so the live search catches this query.
    const result = firstValueFrom(this.pickerResults$);
    this.pickerQuery$.next(query);
    return result;
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
   * resolution, split out so a read-only Public Link page can resolve against the token-scoped
   * public read surface instead of the session-guarded `/api/entities` (ADR-0037, #162).
   */
  protected fetchByIds(ids: string[]): Observable<EntitySummary[]> {
    return this.client.list({ ids }).pipe(map((page) => page.items));
  }

  private fill(ids: string[], items: EntitySummary[]): void {
    const byId = new Map(items.map((e) => [e.id, e]));
    for (const id of ids) {
      const entity = byId.get(id);
      this.cache
        .get(id)
        ?.set(entity ? { status: 'found', entity } : { status: 'missing' });
    }
  }
}
