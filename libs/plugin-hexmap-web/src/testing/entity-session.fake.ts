import { Provider } from '@angular/core';
import { EntityDocument } from '@hexly/domain';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { FakeEntitySession as BaseFakeEntitySession } from '@hexly/web-entity/testing';
import { emptyHexMap, HEX_GRID_FIELD, HexMap } from '@hexly/plugin-hexmap';
import { HexMapStore } from '../services/hexmap-store';

/** The grid is an EntityDocument value at the `core.type.hex-map` type's `grid` Field (ADR-0050); the grid
 * lives in the one EntityDocument map (ADR-0051). `unknown`, not `HexMap`, so {@link FakeEntitySession.loadRawGrid}
 * can seed a document at rest this build can't parse. */
function docWithGrid(grid: unknown): EntityDocument {
  return { [HEX_GRID_FIELD.id]: grid };
}

/**
 * A grid-flavoured {@link BaseFakeEntitySession} for the map plugin's specs: it opens on an empty
 * plane and adds grid-shaped {@link load} helpers over the generic {@link BaseFakeEntitySession.loadDoc}.
 */
export class FakeEntitySession extends BaseFakeEntitySession {
  constructor() {
    super();
    this.seedDoc(docWithGrid(emptyHexMap()));
  }

  /** Test helper: adopt a fresh grid as the working document and bump the load generation (a fresh load). */
  load(grid: HexMap): void {
    this.loadDoc(docWithGrid(grid));
  }

  /**
   * Test helper: adopt whatever sits at the `grid` key, well-formed or not — a document at rest
   * this build cannot parse, which Field validation tolerates rather than rejecting (ADR-0050).
   */
  loadRawGrid(grid: unknown): void {
    this.loadDoc(docWithGrid(grid));
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
 * `core.type.hex-map`'s own `grid` Field. The Field key is explicit because the store requires one; in
 * the app it comes from the entity page's outlet. A spec exercising a second grid overrides
 * {@link VIEW_FIELD_KEY} with its own key.
 */
export function provideHexMapStoreTesting(): Provider[] {
  return [HexMapStore, { provide: VIEW_FIELD_KEY, useValue: HEX_GRID_FIELD.id }, ...provideFakeEntitySession()];
}
