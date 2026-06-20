import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Sends the session cookie with every request, including cross-origin ones.
 * In dev the cookie rides along anyway because the proxy makes requests
 * same-origin, but a cross-origin/prod deploy drops credentials unless they are
 * opted in explicitly (ADR-0004, ADR-0005).
 */
export const withCredentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
