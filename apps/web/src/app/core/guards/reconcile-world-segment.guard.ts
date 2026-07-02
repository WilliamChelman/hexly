import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { EntitiesClient } from '../services/entities.client';
import { entityRoute } from '../utils/routes';

/**
 * Reconcile guard for `/w/:worldId/entities/:id` (ADR-0028, issue #119): the
 * highest-point guard on the detail route. The Entity's own `world_id` is the
 * data source of truth; the `:worldId` segment is only navigation context. When a
 * stale or hand-edited segment contradicts the loaded Entity's real World, this
 * redirects to the same Entity under its correct World segment, so the user always
 * lands somewhere coherent. A matching segment passes through untouched.
 *
 * It looks the Entity up by id only (ADR-0025), the same pattern as
 * {@link entityWorldRedirect}. A missing or inaccessible target falls through
 * (returns `true`) so the Entity page renders its own error state rather than
 * bouncing. This handles stale URLs only — not move-between-Worlds (ADR-0024).
 */
export const reconcileWorldSegment: CanActivateFn = (route) => {
  const id = route.paramMap.get('id') ?? '';
  const segment = route.parent?.paramMap.get('worldId');
  const router = inject(Router);
  return inject(EntitiesClient)
    .list({ ids: [id] })
    .pipe(
      map((page) => {
        const target = page.items[0];
        return target && target.worldId !== segment
          ? router.createUrlTree(entityRoute(target.worldId, id))
          : true;
      }),
      catchError(() => of(true)),
    );
};
