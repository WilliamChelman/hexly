import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, CanActivateFn, CanDeactivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { EMPTY, catchError, map, of, switchMap } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { WorldDetail } from '@hexly/domain';
import { WorldsClient } from './worlds.client';
import { EVICTED } from './live-follow';
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
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _world = signal<WorldDetail | null>(null);
  private readonly _worldId = signal<string | null>(null);

  readonly world = this._world.asReadonly();
  /** The active World id — pinned even when the detail failed to load. */
  readonly worldId = this._worldId.asReadonly();
  readonly name = computed(() => this._world()?.name ?? null);

  constructor() {
    // Live-follow the active World (ADR-0044):
    // - EVICTED (membership loss, World deleted, a 403/404 reconnect refetch) → blank the World and
    //   send the viewer to the Index rather than leave an open Dashboard they can't enter.
    // - a fresh detail (rename, pin reorder, metadata) → re-pin it.
    toObservable(this._worldId)
      .pipe(
        switchMap((id) => (id === null ? EMPTY : this.worlds.watch(id))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result === EVICTED) {
          this.evict();
          return;
        }
        // Only apply a detail at least as fresh as the held one. The store's refetch and this tab's
        // own commitPins are independent with no response ordering: a stale read (one that resolved
        // late, from before commitPins committed) must not revert a newer local write to old pins.
        const held = this._world();
        if (!held || result.updatedAt >= held.updatedAt) this.set(result);
      });
  }

  /** Blank the active World and return to the World Index — the eviction landing. */
  private evict(): void {
    this._world.set(null);
    this._worldId.set(null);
    this.router.navigate(['/']);
  }

  /**
   * Pin the active World. Pass the loaded {@link WorldDetail}, an id string to pin
   * the id alone (detail unknown — e.g. a failed fetch), or `null` to clear.
   */
  set(world: WorldDetail | string | null, worldId?: string | null): void {
    const detail = typeof world === 'string' ? null : world;
    this._world.set(detail);
    const _worldId = worldId ?? (typeof world === 'string' ? world : (detail?.id ?? null));
    if (_worldId !== this._worldId()) {
      this._worldId.set(_worldId);
    }
  }

  /**
   * Persist the active World's pin set wholesale and re-pin from the returned
   * Detail. Owner-only server-side; a failure toasts and leaves the pins as they
   * were.
   */
  commitPins(pinnedEntityIds: string[]): void {
    const worldId = this._worldId();
    if (!worldId) return;
    this.worlds.setPins(worldId, pinnedEntityIds).subscribe({
      next: (detail) => this.set(detail),
      error: () => this.toaster.show(this.transloco.translate('core.pinError'), 'error'),
    });
  }
}

/**
 * Pins {@link ActiveWorld} from the `:worldId` segment and self-heals its decorative slug: it
 * decodes the id, fetches the World detail (reusing an already-pinned one, so the heal redirect
 * never re-fetches), and rewrites a bare, stale, or legacy World segment to the canonical
 * `slug-base62` form via a `replaceUrl` redirect that preserves the child path and query. The base62
 * suffix stays the sole authority, so an un-healed URL still resolves. A failed fetch pins the id
 * alone and lets the page render its own error.
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
