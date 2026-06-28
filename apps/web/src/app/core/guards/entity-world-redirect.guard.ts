import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { EntitiesClient } from '../services/entities.client';

/**
 * Resolves an Entity's World from its id and redirects the World-agnostic
 * `/entities/:id` link to its canonical `/w/:worldId/entities/:id` route
 * (issue #118 follow-up). Content Links don't carry their target's World — a link
 * can point across Worlds — so this is the one place that looks it up, by id only
 * (ADR-0025), never pulling the whole list. A missing or inaccessible target falls
 * through (returns `true`) so the route's error page renders instead of redirecting.
 */
export const entityWorldRedirect: CanActivateFn = (route) => {
  const id = route.paramMap.get('id') ?? '';
  const router = inject(Router);
  return inject(EntitiesClient)
    .list({ ids: [id] })
    .pipe(
      map((page) => {
        const target = page.items[0];
        return target
          ? router.createUrlTree(['/w', target.worldId, 'entities', id])
          : true;
      }),
      catchError(() => of(true)),
    );
};
