import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { ENTITY_LIST_MAX_LIMIT, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';

/** A link's resolution against the owner's live entity list (issue #95, ADR-0023). */
export type EntityResolution =
  | { status: 'loading' }
  | { status: 'found'; entity: EntitySummary }
  | { status: 'missing' };

/**
 * The shared id→name resolver behind every Content Entity Link in a note
 * (ADR-0023). One owner-scoped `list()` fetch backs both the `@` picker and the
 * node views, so they don't each refetch; resolution reads the **live** name, so
 * a renamed target reflects automatically while a deleted one resolves to
 * `missing` (the node view then renders its stored `label` as a dangling link).
 *
 * Provided per note surface so navigating to another Entity gets a fresh list.
 */
@Injectable()
export class EntityNameResolver {
  private readonly client = inject(EntitiesClient);
  private readonly destroyRef = inject(DestroyRef);

  /** The owner's entities; null while the shared list loads. */
  private readonly entities = signal<EntitySummary[] | null>(null);
  private loadStarted = false;
  // Mirrors the load for promise consumers (the `@` picker): ReplaySubject(1) so a
  // late awaiter still gets the already-loaded list.
  private readonly loadedSubject = new ReplaySubject<EntitySummary[]>(1);

  /** The owner's entities as a signal; null until the shared list loads. */
  readonly all: Signal<EntitySummary[] | null> = computed(() => {
    this.ensureLoaded();
    return this.entities();
  });

  /**
   * The owner's entities for the `@` picker, as a Promise — `@tiptap/suggestion`
   * awaits `items`, so the menu can open before the list lands and re-render once
   * it does (no empty-then-stuck popup). Same single fetch as {@link all}.
   */
  loaded(): Promise<EntitySummary[]> {
    this.ensureLoaded();
    return firstValueFrom(this.loadedSubject);
  }

  /** Resolve an id against the shared cache. Reactive: re-reads when the list loads. */
  resolve(id: string): EntityResolution {
    this.ensureLoaded();
    const list = this.entities();
    if (list === null) return { status: 'loading' };
    const entity = list.find((e) => e.id === id);
    return entity ? { status: 'found', entity } : { status: 'missing' };
  }

  // Lazy: the one owner-list fetch fires on first real use (a node view resolving,
  // or the picker awaiting `loaded`), not on construction — so editor surfaces with
  // no links and no open picker make no request. ponytail: one page (≤200);
  // paginate when an owner's library exceeds it.
  private ensureLoaded(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;
    this.client
      .list({ limit: ENTITY_LIST_MAX_LIMIT })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          const items = [...page.items];
          this.entities.set(items);
          this.loadedSubject.next(items);
        },
        error: () => {
          this.entities.set([]);
          this.loadedSubject.next([]);
        },
      });
  }
}
