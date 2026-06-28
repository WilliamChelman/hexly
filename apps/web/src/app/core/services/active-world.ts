import { Injectable, inject, signal } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanDeactivateFn,
  ResolveFn,
} from '@angular/router';

/**
 * The active World (ADR-0028): which World the shell and routed pages act within.
 * It is a URL fact — the `:worldId` path segment is the source of truth — but the
 * value is pinned here by {@link activeWorldResolver} on the `w/:worldId` route,
 * not parsed out of the URL string. Holding it as one signal lets the switcher,
 * the nav rail, the entity browser, and the content links read a single value;
 * it is `null` on the World Index (`/`), where no World is open.
 */
@Injectable({ providedIn: 'root' })
export class ActiveWorld {
  private readonly _worldId = signal<string | null>(null);

  /** The active World's id, or `null` outside a World (the Index). */
  readonly worldId = this._worldId.asReadonly();

  /** Pin the active World. Called by the route resolver, not by components. */
  set(id: string | null): void {
    this._worldId.set(id);
  }
}

/**
 * Pins {@link ActiveWorld} from the `:worldId` segment (ADR-0028). On the
 * `w/:worldId` parent it runs on entry and on every World-scope change (the param
 * change re-runs the resolver without deactivating the route).
 */
export const activeWorldResolver: ResolveFn<string | null> = (
  route: ActivatedRouteSnapshot,
) => {
  const worldId = route.paramMap.get('worldId');
  inject(ActiveWorld).set(worldId);
  return worldId;
};

/**
 * Clears {@link ActiveWorld} when leaving the World scope (ADR-0028). On the
 * `w/:worldId` parent's `canDeactivate`, so stepping out to the Index (or login)
 * drops the scope; a param-only hop between Worlds keeps the route active and so
 * never fires this — the resolver re-pins instead.
 */
export const clearActiveWorld: CanDeactivateFn<unknown> = () => {
  inject(ActiveWorld).set(null);
  return true;
};
