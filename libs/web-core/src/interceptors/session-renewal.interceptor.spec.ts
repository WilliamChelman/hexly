import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DESKTOP_BRIDGE } from '../services/desktop-bridge';
import { sessionRenewalInterceptor } from './session-renewal.interceptor';

/** The Desktop App as the client sees it: a bridge, present or absent (ADR-0070, ADR-0071). */
describe('sessionRenewalInterceptor (#321)', () => {
  let renewals: number;

  /** Configure with `renewSession` behaving as given — or, with no argument, with no bridge at all. */
  function appWith(renewSession?: () => Promise<void>): { http: HttpClient; backend: HttpTestingController } {
    const bridge = renewSession ? { renewSession: () => (renewals++, renewSession()) } : null;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionRenewalInterceptor])),
        provideHttpClientTesting(),
        { provide: DESKTOP_BRIDGE, useValue: bridge },
      ],
    });
    return { http: TestBed.inject(HttpClient), backend: TestBed.inject(HttpTestingController) };
  }

  /** The renewal is a promise, so the retry rides a later task — never the flush's own. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  beforeEach(() => (renewals = 0));

  it('re-mints and re-issues the request, so the caller never sees the 401', async () => {
    const { http, backend } = appWith(() => Promise.resolve());
    const seen: unknown[] = [];
    http.get('/api/auth/me').subscribe({ next: (v) => seen.push(v), error: (e) => seen.push(e) });

    backend.expectOne('/api/auth/me').flush('no session', unauthorized);
    await settle();
    expect(renewals).toBe(1);
    backend.expectOne('/api/auth/me').flush({ id: 'u1' });

    expect(seen).toEqual([{ id: 'u1' }]);
    backend.verify();
  });

  it('leaves a 401 alone when there is no bridge, which is every browser', async () => {
    const { http, backend } = appWith();
    const seen: unknown[] = [];
    http.get('/api/auth/me').subscribe({ error: (e) => seen.push(e) });

    backend.expectOne('/api/auth/me').flush('no session', unauthorized);
    await settle();

    expect(renewals).toBe(0);
    expect((seen[0] as HttpErrorResponse).status).toBe(401);
    // No retry was issued, or `verify()` would fail on an outstanding second request.
    backend.verify();
  });

  it('renews once for concurrent 401s, since each re-mint revokes the session before it', async () => {
    const { http, backend } = appWith(() => Promise.resolve());
    http.get('/api/worlds').subscribe({ error: () => undefined });
    http.get('/api/auth/me').subscribe({ error: () => undefined });

    for (const url of ['/api/worlds', '/api/auth/me']) backend.expectOne(url).flush('no session', unauthorized);
    await settle();

    expect(renewals).toBe(1);
    backend.expectOne('/api/worlds').flush([]);
    backend.expectOne('/api/auth/me').flush({ id: 'u1' });
    backend.verify();
  });

  it('retries without re-minting when the session has already moved on, sparing the other retries', async () => {
    const { http, backend } = appWith(() => Promise.resolve());
    // Both issued under the same session; only the first 401 comes back inside the renewal's window.
    http.get('/api/auth/me').subscribe({ error: () => undefined });
    http.get('/api/worlds').subscribe({ error: () => undefined });

    backend.expectOne('/api/auth/me').flush('no session', unauthorized);
    await settle();
    backend.expectOne('/api/auth/me').flush({ id: 'u1' });

    // The straggler's 401 predates that re-mint, so it needs the retry and not a second one — which would
    // revoke the session the first request is now using.
    backend.expectOne('/api/worlds').flush('no session', unauthorized);
    await settle();

    expect(renewals).toBe(1);
    backend.expectOne('/api/worlds').flush([]);
    backend.verify();
  });

  it('does not loop: a retry that 401s again reaches the caller', async () => {
    const { http, backend } = appWith(() => Promise.resolve());
    const seen: unknown[] = [];
    http.get('/api/auth/me').subscribe({ error: (e) => seen.push(e) });

    backend.expectOne('/api/auth/me').flush('no session', unauthorized);
    await settle();
    backend.expectOne('/api/auth/me').flush('still no session', unauthorized);
    await settle();

    expect(renewals).toBe(1);
    expect((seen[0] as HttpErrorResponse).status).toBe(401);
    backend.verify();
  });

  it('reports the original 401 when the bridge cannot re-mint', async () => {
    const { http, backend } = appWith(() => Promise.reject(new Error('main is gone')));
    const seen: unknown[] = [];
    http.get('/api/auth/me').subscribe({ error: (e) => seen.push(e) });

    backend.expectOne('/api/auth/me').flush('no session', unauthorized);
    await settle();

    expect(renewals).toBe(1);
    expect((seen[0] as HttpErrorResponse).status).toBe(401);
    backend.verify();
  });

  it('renews for a 401 only — every other failure is not a session problem', async () => {
    const { http, backend } = appWith(() => Promise.resolve());
    const seen: unknown[] = [];
    http.get('/api/worlds').subscribe({ error: (e) => seen.push(e) });

    backend.expectOne('/api/worlds').flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();

    expect(renewals).toBe(0);
    expect((seen[0] as HttpErrorResponse).status).toBe(500);
    backend.verify();
  });
});
