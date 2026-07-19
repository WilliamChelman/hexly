import { Provider } from '@angular/core';
import { EntityDocument } from '@hexly/domain';
import { BoardSurface, emptyBoardSurface, SURFACE_FIELD } from '@hexly/plugin-board';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { FakeEntitySession as BaseFakeEntitySession } from '@hexly/web-entity/testing';
import { BoardStore } from '../services/board-store';

/**
 * The surface is an EntityDocument value at the `core.surface` Field (ADR-0050/0051); it lives in the
 * one EntityDocument map. `unknown`, not `BoardSurface`, so {@link FakeEntitySession.loadRawSurface}
 * can seed a document at rest this build can't parse.
 */
function docWithSurface(surface: unknown): EntityDocument {
  return { [SURFACE_FIELD.id]: surface };
}

/**
 * A surface-flavoured {@link BaseFakeEntitySession} for the board plugin's specs: it opens on an empty
 * plane and adds surface-shaped {@link load} helpers over the generic {@link BaseFakeEntitySession.loadDoc}.
 */
export class FakeEntitySession extends BaseFakeEntitySession {
  constructor() {
    super();
    this.seedDoc(docWithSurface(emptyBoardSurface()));
  }

  /** Test helper: adopt a fresh surface as the working document and bump the load generation (a fresh load). */
  load(surface: BoardSurface): void {
    this.loadDoc(docWithSurface(surface));
  }

  /**
   * Test helper: adopt whatever sits at the `core.surface` key, well-formed or not — a document at rest
   * this build cannot parse, which Field validation tolerates rather than rejecting (ADR-0050).
   */
  loadRawSurface(surface: unknown): void {
    this.loadDoc(docWithSurface(surface));
  }
}

/**
 * Provided under both keys so a spec can `TestBed.inject(FakeEntitySession)` to reach the test-only
 * helpers and the store resolves the same instance through {@link ENTITY_SESSION}.
 */
export function provideFakeEntitySession(): Provider[] {
  return [FakeEntitySession, { provide: ENTITY_SESSION, useExisting: FakeEntitySession }];
}

/**
 * Providers for a spec that injects the route-scoped {@link BoardStore}, over `core.board`'s own
 * `core.surface` Field. The Field key is explicit because the store requires one; in the app it comes
 * from the entity page's outlet. A spec exercising a second surface overrides {@link VIEW_FIELD_KEY}
 * with its own key.
 */
export function provideBoardStoreTesting(): Provider[] {
  return [BoardStore, { provide: VIEW_FIELD_KEY, useValue: SURFACE_FIELD.id }, ...provideFakeEntitySession()];
}
