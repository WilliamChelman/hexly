import { HttpErrorResponse } from '@angular/common/http';
import { isAccessLoss } from './http-errors';

describe('isAccessLoss', () => {
  const status = (s: number) => new HttpErrorResponse({ status: s });

  it('is true for 403 and 404 — access is gone (revoked / deleted)', () => {
    expect(isAccessLoss(status(403))).toBe(true);
    expect(isAccessLoss(status(404))).toBe(true);
  });

  it('is false for a transient failure — 5xx and network blips self-heal', () => {
    expect(isAccessLoss(status(500))).toBe(false);
    expect(isAccessLoss(status(503))).toBe(false);
    expect(isAccessLoss(status(0))).toBe(false); // network error
  });

  it('is false for 401 — session expiry is transient here, not access loss', () => {
    // The API returns 401 (not 403) for an expired/absent session; a cookie-refresh race
    // must not evict a valid follow.
    expect(isAccessLoss(status(401))).toBe(false);
  });

  it('is false for a non-HTTP error', () => {
    expect(isAccessLoss(new Error('boom'))).toBe(false);
    expect(isAccessLoss(undefined)).toBe(false);
  });
});
