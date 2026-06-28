import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthClient } from './auth.client';
import { WorldsClient } from './worlds.client';

/**
 * The caller's loaded Worlds (ADR-0028). Which World is *active* is a URL fact now
 * ({@link ActiveWorld}), not a remembered selection — so this store no longer holds
 * an active id or persists anything to localStorage. It is just the loaded list plus
 * the create plumbing: the World Index and the switcher read {@link worlds}/{@link
 * loaded}, and {@link create} mints a World (the server creates its Home Entity
 * atomically); the caller navigates into it by URL.
 */
@Injectable({ providedIn: 'root' })
export class WorldStore {
  private readonly client = inject(WorldsClient);
  private readonly auth = inject(AuthClient);

  private readonly _worlds = signal<readonly WorldSummary[]>([]);
  private readonly _loaded = signal(false);
  private readonly _loadError = signal(false);
  // ponytail: no retry-on-error beyond the guard reset; add a refresh() if worlds
  // ever change out-of-band.
  private hasLoaded = false;

  /** The caller's Worlds (owned + member), as last loaded. */
  readonly worlds = this._worlds.asReadonly();
  /** True once load() has resolved (whether with Worlds or empty) — gates the empty state. */
  readonly loaded = this._loaded.asReadonly();
  /** True when the last load() call failed — gates the error state in the World Index. */
  readonly loadError = this._loadError.asReadonly();

  constructor() {
    // Reset the store whenever the authenticated user changes — prevents cross-session
    // data leaks (logout → re-login on the same tab shows the new user's Worlds).
    effect(() => {
      this.auth.currentUser();
      untracked(() => {
        this.hasLoaded = false;
        this._loaded.set(false);
        this._loadError.set(false);
        this._worlds.set([]);
      });
    });
  }

  /**
   * Fetch the caller's Worlds. Sets {@link loaded} on both success and error so the
   * World Index can surface its resolved state (list or empty) even when the call
   * fails; an error resets the guard so a later load() retries.
   */
  load(): void {
    if (this.hasLoaded) return;
    this.hasLoaded = true;
    this.client.list().subscribe({
      next: (worlds) => {
        this._worlds.set(worlds);
        this._loaded.set(true);
      },
      error: () => {
        this.hasLoaded = false;
        this._loadError.set(true);
        this._loaded.set(true);
      },
    });
  }

  /** Create a World (server mints its Home Entity) and append it to the list. */
  create(name: string): Observable<WorldDetail> {
    return this.client.create(name).pipe(
      tap((world) => this._worlds.update((ws) => [...ws, world])),
    );
  }
}
