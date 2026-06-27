import {
  DestroyRef,
  Injectable,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { ENTITY_LIST_MAX_LIMIT, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';

/** A link's resolution against the owner's entities (issue #95, ADR-0023). */
export type EntityResolution =
  | { status: 'loading' }
  | { status: 'found'; entity: EntitySummary }
  | { status: 'missing' };

/**
 * The shared id→name resolver behind every Content Entity Link in a note
 * (ADR-0023). Resolution reads the target's **live** name, so a renamed target
 * reflects automatically while a deleted one resolves to `missing` (the node view
 * then renders its stored `label` as a dangling link).
 *
 * Rather than fetch the whole owner library up front (which capped links at one
 * page), it fetches only the ids notes actually reference: a `resolve(id)` queues
 * the id and a microtask coalesces a render's worth of links into one (chunked)
 * `list({ ids })` call. The `@` picker no longer shares an in-memory list — it
 * searches the server directly via {@link search}.
 *
 * Provided per note surface so navigating to another Entity gets a fresh cache.
 */
@Injectable()
export class EntityNameResolver {
  private readonly client = inject(EntitiesClient);
  private readonly destroyRef = inject(DestroyRef);

  // One signal per requested id, created on first resolve and filled when its
  // batch lands; persists for the surface's life so each id is fetched once.
  private readonly cache = new Map<string, WritableSignal<EntityResolution>>();
  // Ids awaiting the next flush — coalesced so a page of links is one request.
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

  /**
   * The owner's entities matching `query`, server-filtered (ADR-0025 `q`) — the
   * `@` picker's source. `@tiptap/suggestion` awaits this per keystroke; a failed
   * search yields an empty list rather than rejecting the popup.
   */
  search(query: string): Promise<EntitySummary[]> {
    return firstValueFrom(
      this.client.list({ q: query.trim(), limit: ENTITY_LIST_MAX_LIMIT }).pipe(
        map((page) => page.items),
        catchError(() => of<EntitySummary[]>([])),
      ),
    );
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  // Batch every id queued this tick into id-set list() calls (chunked to the page
  // cap), then fill each id's signal: found, or missing → dangling link.
  private flush(): void {
    this.flushQueued = false;
    const ids = [...this.pending];
    this.pending.clear();
    for (let i = 0; i < ids.length; i += ENTITY_LIST_MAX_LIMIT) {
      const chunk = ids.slice(i, i + ENTITY_LIST_MAX_LIMIT);
      this.client
        .list({ ids: chunk, limit: chunk.length })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (page) => this.fill(chunk, page.items),
          // A failed batch resolves its ids to missing (dangling) — the link still
          // shows its stored label, matching the old list-fetch error path.
          error: () => this.fill(chunk, []),
        });
    }
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
