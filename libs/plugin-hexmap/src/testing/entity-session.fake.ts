import { Provider, signal } from '@angular/core';
import { emptyContent, EntityBody } from '@hexly/domain';
import { emptyHexMap, HEX_GRID_FIELD, HexMap } from '../lib';
import { applyPatches as immerApplyPatches, Draft, Patch, produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { HexMapStore } from '../web/services/hexmap-store';

/** The grid is a Metadata value at the `core.hexmap` type's `grid` Field (ADR-0050). */
function bodyWithGrid(grid: HexMap): EntityBody {
  return { content: emptyContent(), metadata: { [HEX_GRID_FIELD.key]: grid } };
}

/**
 * A minimal in-memory {@link EntitySession} for the map plugin's specs. {@link load} bumps
 * {@link loadGeneration}, which drives `HexMapStore`'s reset effect — flush the effects after
 * calling it to observe the reset.
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
 * Provided under both keys so a spec can `TestBed.inject(FakeEntitySession)` to reach the
 * test-only helpers and the store resolves the same instance through {@link ENTITY_SESSION}.
 */
export function provideFakeEntitySession(): Provider[] {
  return [FakeEntitySession, { provide: ENTITY_SESSION, useExisting: FakeEntitySession }];
}

/**
 * Providers for a component spec that injects the route-scoped {@link HexMapStore}, over
 * `core.hexmap`'s own `grid` Field. The Field key is explicit because the store requires one; in
 * the app it comes from the entity page's outlet. A spec exercising a second grid overrides
 * {@link VIEW_FIELD_KEY} with its own key.
 */
export function provideHexMapStoreTesting(): Provider[] {
  return [HexMapStore, { provide: VIEW_FIELD_KEY, useValue: HEX_GRID_FIELD.key }, ...provideFakeEntitySession()];
}
