import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { EntitiesClient } from '../services/entities.client';
import { idFromSegment, segment } from '../utils/pretty-id';

/**
 * Reconcile guard for `/w/:worldId/entities/:id` (ADR-0028). The Entity's own
 * `world_id` is the source of truth; the `:worldId` segment is only navigation
 * context. A segment contradicting the loaded Entity's real World redirects to
 * the same Entity under its correct World segment; a matching segment passes
 * through untouched.
 *
 * It also self-heals the decorative Entity slug (ADR-0042): the `:id` segment carries
 * a `slug-base62(id)` form, and a stale, bare, or legacy one is rewritten to the
 * canonical slug via a redirect that preserves query params. A wrong or absent slug is
 * only ever cosmetic — the base62 suffix (or a legacy UUID) is the sole authority,
 * decoded here before the lookup. The World slug is the parent {@link activeWorldGuard}'s
 * job — a wrong-World redirect here emits a bare World segment that the parent then heals
 * on the restart.
 *
 * The Entity is looked up by id only (ADR-0025). A missing or inaccessible target falls
 * through (returns `true`) so the Entity page renders its own error state rather than
 * bouncing. This handles stale URLs only — not move-between-Worlds (ADR-0024).
 */
export const reconcileWorldSegment: CanActivateFn = (route) => {
  const rawEntitySeg = route.paramMap.get('id') ?? '';
  const rawWorldSeg = route.parent?.paramMap.get('worldId') ?? '';
  const entityId = idFromSegment(rawEntitySeg);
  const router = inject(Router);
  return inject(EntitiesClient)
    .list({ ids: [entityId] })
    .pipe(
      map((page) => {
        const target = page.items[0];
        if (!target) return true;

        const entitySeg = segment(entityId, target.name);
        // Wrong World: point at the real one with a bare segment — the parent
        // guard heals its slug on the restart. Right World: preserve the (already
        // parent-healed) World segment and only canonicalise the Entity slug.
        const worldWrong = idFromSegment(rawWorldSeg) !== target.worldId;
        const worldSeg = worldWrong ? segment(target.worldId) : rawWorldSeg;

        return worldSeg !== rawWorldSeg || entitySeg !== rawEntitySeg
          ? router.createUrlTree(['/w', worldSeg, 'entities', entitySeg], {
              queryParams: route.queryParams,
            })
          : true;
      }),
      catchError(() => of(true)),
    );
};
