import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { WorldsClient } from './worlds.client';

/** The remembered active-World selection — survives reloads so a user lands back in their World. */
const ACTIVE_KEY = 'hexly-active-world';

/**
 * The active-World selection (ADR-0024): which of the caller's Worlds the entity
 * browser and "new entity" act within. Holds the loaded Worlds and one active id,
 * persisted to localStorage so a reload keeps the user in place. Deep module — the
 * switcher and browser read three signals and call {@link setActive}/{@link create};
 * the fetch, the fallback, and the persistence all live behind that.
 */
@Injectable({ providedIn: 'root' })
export class WorldStore {
  private readonly client = inject(WorldsClient);

  private readonly _worlds = signal<readonly WorldSummary[]>([]);
  private readonly _activeId = signal<string | null>(
    localStorage.getItem(ACTIVE_KEY),
  );
  // Load-once guard: the nav rail and the switcher both ask to load, but the list
  // changes only via create (folded in-memory), so one fetch suffices.
  // ponytail: no retry-on-error; add a refresh() if worlds ever change out-of-band.
  private hasLoaded = false;

  /** The caller's Worlds (owned + member), as last loaded. */
  readonly worlds = this._worlds.asReadonly();
  readonly activeWorldId = this._activeId.asReadonly();
  /** The active World's summary, or undefined before a load resolves. */
  readonly activeWorld = computed(() =>
    this._worlds().find((w) => w.id === this._activeId()),
  );

  /**
   * Fetch the caller's Worlds and settle the active selection: keep the
   * remembered one if it survived, else fall to the first (or none, if the user
   * has no Worlds).
   */
  load(): void {
    if (this.hasLoaded) return;
    this.hasLoaded = true;
    this.client.list().subscribe((worlds) => {
      this._worlds.set(worlds);
      const remembered = this._activeId();
      const survives = worlds.some((w) => w.id === remembered);
      this.setActive(survives ? remembered : (worlds[0]?.id ?? null));
    });
  }

  /** Switch the active World and remember it. */
  setActive(id: string | null): void {
    this._activeId.set(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  }

  /** Create a World (server mints its Home Entity) and switch to it. */
  create(name: string): Observable<WorldDetail> {
    return this.client.create(name).pipe(
      tap((world) => {
        this._worlds.update((ws) => [...ws, world]);
        this.setActive(world.id);
      }),
    );
  }
}
