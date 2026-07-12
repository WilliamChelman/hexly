import { Provider, signal } from '@angular/core';
import { emptyContent, emptyHexMap, EntityBody, HEX_GRID_FIELD, HexMap } from '@hexly/domain';
import { applyPatches as immerApplyPatches, Draft, Patch, produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession } from '@hexly/web-entity';
import { HexMapStore } from '../services/hexmap-store';

/**
 * Wrap a bare grid as a full body for the fake to hold: the grid is a Metadata value at the
 * `core.hexmap` type's `grid` Field, like any other Field's (ADR-0050).
 */
function bodyWithGrid(grid: HexMap): EntityBody {
  return { content: emptyContent(), metadata: { [HEX_GRID_FIELD.key]: grid } };
}

/**
 * A minimal in-memory {@link EntitySession} for web-map specs: a body the store edits
 * through {@link mutate}/{@link applyPatches}, plus test-only {@link load}/{@link setWritable}
 * standing in for the app's concrete session. {@link load} mirrors the real reset contract —
 * it bumps {@link loadGeneration}, which drives `HexMapStore`'s reset effect (flush the
 * effects after calling it to observe the reset).
 */
export class FakeEntitySession implements EntitySession {
  private readonly _body = signal<EntityBody>(bodyWithGrid(emptyHexMap()));
  readonly body = this._body.asReadonly();

  private readonly _writable = signal(true);
  readonly writable = this._writable.asReadonly();

  private readonly _loadGeneration = signal(0);
  readonly loadGeneration = this._loadGeneration.asReadonly();

  mutate(recipe: (draft: EntityBody) => void): {
    redo: Patch[];
    undo: Patch[];
  } {
    const [next, redo, undo] = produceWithPatches(this._body(), recipe as (draft: Draft<EntityBody>) => void);
    this._body.set(next as EntityBody);
    return { redo, undo };
  }

  applyPatches(patches: Patch[]): void {
    this._body.set(immerApplyPatches(this._body(), patches));
  }

  /** Test helper: adopt a fresh grid as the working body and bump the load generation (a fresh load). */
  load(grid: HexMap): void {
    this._body.set(bodyWithGrid(grid));
    this._loadGeneration.update((n) => n + 1);
  }

  /**
   * Test helper: adopt whatever sits at the `grid` key, well-formed or not — a document at rest
   * this build cannot parse, which Field validation tolerates rather than rejecting (ADR-0050).
   */
  loadRawGrid(grid: unknown): void {
    this._body.set({ content: emptyContent(), metadata: { [HEX_GRID_FIELD.key]: grid } });
    this._loadGeneration.update((n) => n + 1);
  }

  /** Test helper: flip edit-ability (ADR-0037), the gate {@link EntitySession.writable} exposes. */
  setWritable(writable: boolean): void {
    this._writable.set(writable);
  }
}

/**
 * Providers binding {@link ENTITY_SESSION} to a fresh {@link FakeEntitySession} for a spec's
 * TestBed. Provided under both keys so a spec can `TestBed.inject(FakeEntitySession)` to reach
 * the test-only helpers and the store resolves the same instance through the token.
 */
export function provideFakeEntitySession(): Provider[] {
  return [FakeEntitySession, { provide: ENTITY_SESSION, useExisting: FakeEntitySession }];
}

/**
 * Providers for a component spec that injects {@link HexMapStore}: the route-scoped store
 * (no longer `providedIn: 'root'`) bound to a fresh fake session. Inject
 * {@link FakeEntitySession} to reach its test helpers when a spec needs to seed the body.
 */
export function provideHexMapStoreTesting(): Provider[] {
  return [HexMapStore, ...provideFakeEntitySession()];
}
