import { Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, catchError, distinctUntilChanged, map, switchMap } from 'rxjs';
import { ENTITY_SESSION } from '../models/entity-session';

/** A fetched payload, tagged with the Entity it describes. */
interface Loaded<T> {
  readonly id: string;
  readonly value: T;
}

/**
 * Shallow value equality over a flat fetch key. A `computed` re-derives a *new* object whenever the
 * session emits, so without this every nudge would look like a fresh target and refetch.
 */
function sameTarget(a: object | null, b: object | null): boolean {
  if (!a || !b) return a === b;
  const entries = Object.entries(a);
  const other = new Map(Object.entries(b));
  return entries.length === other.size && entries.every(([key, value]) => other.get(key) === value);
}

/**
 * What a Dock Panel reading the open Entity's link index shares (ADR-0067): a payload held only for the
 * Entity it was fetched for, and an ephemeral decor reveal over it (ADR-0069).
 *
 * The Panel is page chrome and stays open across `:id` changes, so a held payload must be *tagged* or it
 * would briefly be attributed to the Entity just opened. Panel-scoped lifetime does the rest: "nothing
 * fetched while closed" and "opening always fetches" fall out of it rather than out of a dock gate. What
 * a subclass still owns is the key a refetch turns on and the read it makes ({@link fetchOn}).
 */
export abstract class EntityPanelStore<T> {
  protected readonly session = inject(ENTITY_SESSION);

  private readonly _loaded = signal<Loaded<T> | null>(null);

  /** The held payload, but only while it still describes the open Entity. */
  protected readonly current = computed(() => {
    const held = this._loaded();
    return held?.id === this.session.current()?.id ? held?.value : undefined;
  });

  /**
   * Whether the panel reveals its Decor Links (ADR-0069). Ephemeral and default-hidden by decision: a
   * peek at presentation wiring, collapsed on every landing so it never becomes a sticky mode roaming
   * across the pages the always-open Panel follows.
   */
  private readonly _revealDecor = signal(false);
  readonly revealDecor = this._revealDecor.asReadonly();

  toggleRevealDecor(): void {
    this._revealDecor.update((revealed) => !revealed);
  }

  /**
   * Wire the panel's read. Call from the subclass constructor, which is where `target`'s own dependencies
   * (a chosen depth, say) are finally initialised — and where the injection context `takeUntilDestroyed`
   * needs still holds.
   */
  protected fetchOn<K extends { readonly id: string }>(
    target: Signal<K | null>,
    fetch: (target: K) => Observable<T>,
  ): void {
    toObservable(target)
      .pipe(
        distinctUntilChanged((a, b) => sameTarget(a, b)),
        // Cancels an outrun fetch, so responses can never land out of order.
        switchMap((t) =>
          t
            ? fetch(t).pipe(
                map((value): Loaded<T> => ({ id: t.id, value })),
                // A failed fetch leaves the last-known payload rather than blanking the panel.
                catchError(() => EMPTY),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => {
        // The peek never survives past the payload it was opened against.
        this._revealDecor.set(false);
        this._loaded.set(loaded);
      });
  }

  /** Seed the panel directly, bypassing the fetch — the test seam, mirroring `EntitySession.adopt`. */
  adopt(id: string, value: T): void {
    this._loaded.set({ id, value });
  }
}
