import { HttpInterceptorFn } from '@angular/common/http';

/** The single path prefix every backend route lives under (see API `main.ts`). */
const API_PREFIX = '/api';

/**
 * Routes every backend request under {@link API_PREFIX}. Stores call clean
 * resource paths (`/entities`, `/auth/login`); this is the one place that knows the
 * API is namespaced under `/api`, keeping that prefix off the SPA's own routes
 * (the client owns `/entities/:id`, the API owns `/api/maps/:id`). Absolute URLs and
 * requests already under `/api` pass through untouched.
 */
export const apiPrefixInterceptor: HttpInterceptorFn = (req, next) => {
  const url = req.url;
  const alreadyPrefixed = url === API_PREFIX || url.startsWith(`${API_PREFIX}/`);
  const isRootRelative = url.startsWith('/');
  return isRootRelative && !alreadyPrefixed
    ? next(req.clone({ url: `${API_PREFIX}${url}` }))
    : next(req);
};
