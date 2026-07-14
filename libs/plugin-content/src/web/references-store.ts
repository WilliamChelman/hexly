import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, distinctUntilChanged, map, switchMap } from 'rxjs';
import { EntityReferences } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { RightDock } from './right-dock';

/** A fetched list, tagged with the Entity it describes. */
interface Loaded {
  readonly id: string;
  readonly value: EntityReferences;
}

/**
 * Route-scoped UI state for the References panel — the open Entity's own links and the Entities
 * that link to it (CONTEXT.md → Entity Link; ADR-0046).
 *
 * The fetch is keyed on the open Entity's `(id, seq)` (ADR-0045), not on `content()`: References
 * read the derived edge index, which the server rebuilds only on a committed save. Nothing is
 * fetched while the panel is closed, and opening it always fetches.
 *
 * Freshness ceiling: `seq` tracks changes to *this* Entity only. A *Referenced by* row added by
 * another Entity's save, or an outbound target's rename, bumps that other Entity's `seq` and never
 * this one's — so an open panel does not see either. It refreshes on reopen, on navigation, and on
 * this Entity's own saves.
 *
 * The page keeps this store alive across `:id` changes, so a held list is tagged with the Entity it
 * was fetched for and shown only for that Entity: swapping Entities blanks the panel rather than
 * briefly attributing one Entity's links to another.
 *
 * The inbound half is access-filtered server-side per viewer.
 */
@Injectable()
export class ReferencesStore {
  private readonly session = inject(ENTITY_SESSION);
  private readonly entities = inject(EntitiesClient);
  private readonly dock = inject(RightDock);

  private readonly _loaded = signal<Loaded | null>(null);

  /** The held list, but only while it still describes the open Entity. */
  private readonly current = computed(() => {
    const held = this._loaded();
    return held?.id === this.session.current()?.id ? held?.value : undefined;
  });

  /** This Entity's own links. A `target` of `null` is deleted-or-unreadable — a dangling link. */
  readonly references = computed(() => this.current()?.references ?? []);
  /** The Entities that link here, filtered to the ones this viewer may read. */
  readonly referencedBy = computed(() => this.current()?.referencedBy ?? []);
  /** False until the open Entity's list has landed, so the panel tells "loading" from "nothing". */
  readonly loaded = computed(() => this.current() !== undefined);

  constructor() {
    /** What the panel wants loaded right now, or `null` while it is closed. */
    const target = computed(() => {
      const entity = this.session.current();
      const showing = this.dock.panel() === 'references';
      return showing && entity ? { id: entity.id, seq: entity.seq } : null;
    });

    toObservable(target)
      .pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.seq === b?.seq),
        // Cancels an outrun fetch, so responses can never land out of order.
        switchMap((t) =>
          t
            ? this.entities.references(t.id).pipe(
                map((value): Loaded => ({ id: t.id, value })),
                // A failed fetch leaves the last-known list rather than blanking the panel.
                catchError(() => EMPTY),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => this._loaded.set(loaded));
  }

  /** Seed the panel directly, bypassing the fetch — the test seam, mirroring `EntitySession.adopt`. */
  adopt(id: string, value: EntityReferences): void {
    this._loaded.set({ id, value });
  }
}
