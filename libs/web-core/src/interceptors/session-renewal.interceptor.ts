import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { SessionRenewal } from '../services/session-renewal';

/**
 * The capability half of 401 recovery (ADR-0070): a 401 is where a lapsed session shows itself, so the
 * renewal goes here. Re-issuing the request puts the boot `GET /api/auth/me` back in an authenticated
 * state before `authGuard` reaches its policy choice, so in the Desktop App an expiry, a cleared cookie
 * jar or a replaced database costs one round trip instead of stranding the user on `/session-error`
 * (#318). In a browser {@link SessionRenewal} has no bridge and the 401 propagates untouched.
 *
 * The retry goes through `next`, which re-enters the chain *below* this interceptor — so a retry that
 * 401s again propagates instead of looping.
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
