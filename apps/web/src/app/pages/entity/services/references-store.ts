import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, distinctUntilChanged, map, switchMap } from 'rxjs';
import { EntityReferences } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { EntitySession } from './entity-session';
import { RightDock } from './right-dock';

/** A fetched list, tagged with the Entity it describes. */
interface Loaded {
  readonly id: string;
  readonly value: EntityReferences;
}

/**
 * Route-scoped UI state for the References panel — the open Entity's own links and the Entities
 * that link to it (CONTEXT.md → Entity Link; ADR-0046). Sibling to {@link OutlineStore}, and
 * deliberately unlike it: the Outline derives from the *live* Content on every keystroke, while
 * References read the derived edge index, which the server rebuilds only on a committed save.
 *
 * So the fetch is keyed on the open Entity's `(id, seq)` — `seq` being the freshness key its every
 * committed change bumps (ADR-0045) — and not on `content()`. Typing a link surfaces it here once
 * it is saved, which is exactly what the index holds. Nothing is fetched while the panel is closed,
 * and opening it always fetches.
 *
 * **The freshness ceiling.** `seq` tracks changes to *this* Entity, and only the outbound half is
 * a function of this Entity's document. *Referenced by* changes when some **other** Entity saves a
 * link here — which bumps that Entity's `seq`, never this one's — and an outbound target's rename
 * likewise moves only the target's. So a panel left open does not see either; it refreshes when
 * reopened, on navigation, and on this Entity's own saves. Live-following it properly would need a
 * per-target interest index the nudge bus deliberately does not keep (ADR-0044), so this is the
 * ceiling rather than an oversight.
 *
 * ponytail: if a stale *Referenced by* ever bites, the cheap fix is refetching on window focus;
 * the honest one is an edge-interest channel on the bus.
 *
 * The page keeps this store alive across `:id` changes (the editor stays mounted), so a held list
 * is **tagged with the Entity it was fetched for** and shown only for that Entity: swapping
 * Entities blanks the panel rather than briefly attributing one Entity's links to another. The
 * `switchMap` drops an in-flight fetch the swap outran, so a slow response can never land on top
 * of a newer one.
 *
 * The inbound half is access-filtered server-side per viewer, so nothing here hides anything: the
 * panel renders exactly the rows it is handed.
 */
@Injectable()
export class ReferencesStore {
  private readonly session = inject(EntitySession);
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
