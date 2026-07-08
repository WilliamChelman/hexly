import { HttpErrorResponse } from '@angular/common/http';

/**
 * Whether a failed refetch means the caller's access is *gone* — 403 Forbidden (a revoked grant /
 * Public Link) or 404 Not Found (deleted, or opaque-unreachable) — and so the followed view should
 * be evicted (#177). A transient failure (5xx, network blip) is NOT access loss: it self-heals on
 * the next nudge or reconnect, so it must not blank a valid follow. Session expiry surfaces as
 * **401** in this API (never 403), so it is deliberately excluded — a cookie-refresh race must not
 * evict. The single definition of "access gone", shared by every live-follow reconciler.
 */
export function isAccessLoss(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 403 || err.status === 404);
}
