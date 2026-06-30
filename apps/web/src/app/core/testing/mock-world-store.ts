import { signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';

/**
 * A driveable stand-in for `WorldStore`, the facade the World Index and switcher
 * depend on. Its loaded state is exposed as writable signals a spec sets directly
 * (`store.setWorlds([...])`, `store.setLoaded(true)`); its commands are spies. Keeps
 * those view tests on the store boundary; the store's own load/reset behaviour is
 * covered by `world.store.spec`.
 */
export class MockWorldStore {
  private readonly _worlds = signal<readonly WorldSummary[]>([]);
  private readonly _loaded = signal(false);
  private readonly _loadError = signal(false);

  readonly worlds = this._worlds.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  setWorlds(worlds: readonly WorldSummary[]): void { this._worlds.set(worlds); }
  setLoaded(loaded: boolean): void { this._loaded.set(loaded); }
  setLoadError(error: boolean): void { this._loadError.set(error); }

  load = vi.fn<() => void>();
  create = vi.fn<(name: string) => Observable<WorldDetail>>(() => EMPTY);
  rename = vi.fn<(id: string, name: string) => Observable<WorldDetail>>(() => EMPTY);
  delete = vi.fn<(id: string) => Observable<void>>(() => of(undefined));
}
