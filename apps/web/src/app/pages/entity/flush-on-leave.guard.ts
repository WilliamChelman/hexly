import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';

/**
 * Persist a pending autosave before leaving `/entities/:id` (ADR-0026). onDestroy runs too
 * late to block navigation, so the guard awaits the route component's flush up front. Typed
 * structurally so it doesn't pull the lazy {@link EntityPage} into the eager bundle.
 */
export const flushOnLeave: CanDeactivateFn<{
  canDeactivate(): Observable<boolean>;
}> = (page) => page.canDeactivate();
