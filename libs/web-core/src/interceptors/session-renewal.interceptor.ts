import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { SessionRenewal } from '../services/session-renewal';

/**
 * The capability half of 401 recovery (ADR-0070, #318): re-issuing the request keeps a lapsed session from
 * stranding the Desktop App's user on `/session-error`. In a browser {@link SessionRenewal} has no bridge and
 * the 401 propagates untouched.
 *
 * The retry goes through `next`, which re-enters the chain below this interceptor, so a retry that 401s again
 * propagates instead of looping.
 */
export const sessionRenewalInterceptor: HttpInterceptorFn = (req, next) => {
  const renewal = inject(SessionRenewal);
  // Read before the request goes out, so its 401 can be told apart from one the session has moved past.
  const generation = renewal.generation;
  return next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      return from(renewal.renew(generation)).pipe(
        switchMap((renewed) => (renewed ? next(req) : throwError(() => err))),
      );
    }),
  );
};
