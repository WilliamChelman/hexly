import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthScopedStorage } from './auth-scoped-storage';
import { WorldsClient } from './worlds.client';

const ACTIVE_KEY = 'hexly-active-world';

/**
 * The active-World selection (ADR-0024): which of the caller's Worlds the entity
 * browser and "new entity" act within. Holds the loaded Worlds and one active id,
 * persisted to auth-scoped localStorage so a reload keeps the user in place without
 * leaking one user's selection to another on the same tab. Deep module — the
 * switcher and browser read four signals and call {@link setActive}/{@link create};
 * the fetch, the fallback, the persistence, and the logout-reset all live behind that.
 */
@Injectable({ providedIn: 'root' })
export class WorldStore {
  private readonly client = inject(WorldsClient);
  private readonly storage = inject(AuthScopedStorage);

  private readonly _worlds = signal<readonly WorldSummary[]>([]);
  private readonly _activeId = signal<string | null>(null);
  private readonly _loaded = signal(false);
  // ponytail: no retry-on-error; add a refresh() if worlds ever change out-of-band.
  private hasLoaded = false;

  /** The caller's Worlds (owned + member), as last loaded. */
  readonly worlds = this._worlds.asReadonly();
  readonly activeWorldId = this._activeId.asReadonly();
  /** True once load() has resolved (whether with Worlds or empty) — gates the zero-World empty state. */
  readonly loaded = this._loaded.asReadonly();
  /** The active World's summary, or undefined before a load resolves. */
  readonly activeWorld = computed(() =>
    this._worlds().find((w) => w.id === this._activeId()),
  );

  constructor() {
    // Reset the store whenever the authenticated user changes — prevents cross-session
    // data leaks (logout → re-login on the same tab shows the new user's Worlds, not
    // the previous user's). Reads the user-scoped localStorage key on each transition.
    effect(() => {
      const userId = this.storage.userId();
      untracked(() => {
        this.hasLoaded = false;
        this._loaded.set(false);
        this._worlds.set([]);
        this._activeId.set(userId ? this.storage.getItem(ACTIVE_KEY) : null);
      });
    });
  }

  /**
   * Fetch the caller's Worlds and settle the active selection: keep the
   * remembered one if it survived, else fall to the first (or none, if the user
   * has no Worlds). Sets {@link loaded} on both success and error so consumers
   * can surface the resolved state even when the list is empty or the call fails.
   */
  load(): void {
    if (this.hasLoaded) return;
    this.hasLoaded = true;
    this.client.list().subscribe({
      next: (worlds) => {
        this._worlds.set(worlds);
        const remembered = this._activeId();
        const survives = worlds.some((w) => w.id === remembered);
        this.setActive(survives ? remembered : (worlds[0]?.id ?? null));
        this._loaded.set(true);
      },
      error: () => {
        // Allow retry: a transient failure should not permanently block the load.
        this.hasLoaded = false;
        this._loaded.set(true);
      },
    });
  }

  /** Switch the active World and remember it under the auth-scoped key. */
  setActive(id: string | null): void {
    this._activeId.set(id);
    if (id) this.storage.setItem(ACTIVE_KEY, id);
    else this.storage.removeItem(ACTIVE_KEY);
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
