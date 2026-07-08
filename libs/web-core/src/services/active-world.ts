import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  CanDeactivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { WorldDetail } from '@hexly/domain';
import { WorldsClient } from './worlds.client';
import { ToasterService } from './toaster.service';
import { healWorldSegment, idFromSegment } from '../utils/pretty-id';

/**
 * The active World: which World the shell and routed pages act within, plus its
 * loaded {@link WorldDetail}. Which World is active is a URL fact — the
 * `:worldId` path segment is the source of truth — but the detail is fetched and
 * pinned here by {@link activeWorldGuard} so consumers read one loaded value
 * instead of each re-fetching. Both are `null` on the World Index (`/`).
 */
@Injectable({ providedIn: 'root' })
export class ActiveWorld {
  private readonly worlds = inject(WorldsClient);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly _world = signal<WorldDetail | null>(null);
  private readonly _worldId = signal<string | null>(null);

  readonly world = this._world.asReadonly();
  /** The active World id — pinned even when the detail failed to load. */
  readonly worldId = this._worldId.asReadonly();
  readonly name = computed(() => this._world()?.name ?? null);

  /**
   * Pin the active World. Pass the loaded {@link WorldDetail}, an id string to pin
   * the id alone (detail unknown — e.g. a failed fetch), or `null` to clear.
   */
  set(world: WorldDetail | string | null, worldId?: string | null): void {
    const detail = typeof world === 'string' ? null : world;
    this._world.set(detail);
    const _worldId =
      worldId ?? (typeof world === 'string' ? world : (detail?.id ?? null));
    if (_worldId !== this._worldId()) {
      this._worldId.set(_worldId);
    }
  }

  /**
   * Persist the active World's pin set wholesale and re-pin from the returned
   * Detail. Owner-only server-side; a failure toasts and leaves the pins as they
   * were. The single home for every pin-mutating surface, so all share one error UX.
   */
  commitPins(pinnedEntityIds: string[]): void {
    const worldId = this._worldId();
    if (!worldId) return;
    this.worlds.setPins(worldId, pinnedEntityIds).subscribe({
      next: (detail) => this.set(detail),
      error: () =>
        this.toaster.show(
          this.transloco.translate('worldDashboard.pinError'),
          'error',
        ),
    });
  }
}

/**
 * Pins {@link ActiveWorld} from the `:worldId` segment and self-heals its
 * decorative slug. It decodes the id, fetches the World detail (reusing an
 * already-pinned one so the heal redirect never re-fetches), and pins it. With the
 * name in hand it rewrites a bare, stale, or legacy World segment to the canonical
 * `slug-base62` form via a `replaceUrl` redirect that preserves the child path and
 * query — the base62 suffix stays the sole authority, so an un-healed URL still
 * resolves. A failed fetch pins the id alone and lets the page render its own error.
 */
export const activeWorldGuard: CanActivateFn = (route, state) => {
  const worldId = idFromSegment(route.paramMap.get('worldId') ?? '');
  const active = inject(ActiveWorld);
  const router = inject(Router);

  const proceed = (world: WorldDetail | null) => {
    active.set(world, worldId);
    if (!world) return true;
    const healed = healWorldSegment(state.url, worldId, world.name);
    return healed ? router.parseUrl(healed) : true;
  };

  if (active.worldId() === worldId && active.world()) {
    return proceed(active.world());
  }
  return inject(WorldsClient)
    .get(worldId)
    .pipe(
      map((world) => proceed(world)),
      catchError(() => of(proceed(null))),
    );
};

/** The World id the router state resolves to, or `null` when it isn't World-scoped. */
function targetWorldId(state: RouterStateSnapshot): string | null {
  for (let r: ActivatedRouteSnapshot | null = state.root; r; r = r.firstChild) {
    const seg = r.paramMap.get('worldId');
    if (seg) return idFromSegment(seg);
  }
  return null;
}

/**
 * Clears {@link ActiveWorld} when leaving the World scope, on the `w/:worldId`
 * parent's `canDeactivate`. Only clears when the destination truly leaves this
 * World: the slug self-heal bounces through a `replaceUrl` redirect that
 * deactivates this parent, and clearing on it would blank the World-scoped rail
 * for a frame. The decoded id is the identity, not the segment string, so a
 * uuid↔slug hop reads as "same World" and the scope stays pinned.
 */
export const clearActiveWorld: CanDeactivateFn<unknown> = (_c, _r, _s, nextState) => {
  const active = inject(ActiveWorld);
  if (targetWorldId(nextState) !== active.worldId()) {
    active.set(null);
  }
  return true;
};
