import { InjectionToken, Signal } from '@angular/core';
import { HexMap } from '@hexly/domain';

/**
 * The narrow contract {@link EntitySession} needs from the hex-grid payload's live
 * editor — load a grid, read the working grid (for dirty-checking and save), and set
 * whether it is editable. Declared by the session, *implemented* by `HexMapStore`
 * (wired via {@link GRID_STORE} at the composition root), so the session inverts its
 * dependency and never imports `@hexly/web-map` — the map lib depends on this
 * abstraction, not the other way round (ADR-0048).
 *
 * A note carries no grid, so its provider binds `HexMapStore` all the same and the
 * session's `withGrid`/`hasHexGrid` seam simply passes the body through untouched.
 */
export interface GridStore {
  /** Adopt `grid` as the working document (a fresh start, clearing edit history). */
  load(grid: HexMap): void;
  /** The live working grid — the dirty-check key and the save snapshot source. */
  readonly document: Signal<HexMap>;
  /** Whether the caller may edit the grid (ADR-0037); gates the map view's tools. */
  setEditable(editable: boolean): void;
}

/** DI token for the {@link GridStore}; the composition root binds `HexMapStore` to it. */
export const GRID_STORE = new InjectionToken<GridStore>('GRID_STORE');
