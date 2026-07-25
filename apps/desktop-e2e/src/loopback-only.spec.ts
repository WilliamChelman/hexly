import { request as httpRequest } from 'node:http';
import { expect, test } from './desktop-app';

/**
 * The DNS-rebinding wall in front of the loopback socket (ADR-0070, #321): asserted from a raw socket rather
 * than a browser, because the attack is a *forged* `Host`, which no browser will send.
 */
test('the socket answers the address it bound and rejects every other name', async ({ launch }) => {
  const run = await launch();
  const { host } = new URL(run.origin);

  const own = await fetchRaw(run.origin, '/api/config', { Host: host });
  expect(own.status).toBe(200);
  // The absence is the load-bearing part (ADR-0008, ADR-0070).
  expect(own.headers['access-control-allow-origin']).toBeUndefined();

  const rebound = await fetchRaw(run.origin, '/api/config', { Host: 'hexly.evil.example' });
  expect(rebound.status).toBe(403);

  // A rebound page's `fetch` sends both, so a right `Host` is not enough.
  const crossOrigin = await fetchRaw(run.origin, '/api/config', { Host: host, Origin: 'https://evil.example' });
  expect(crossOrigin.status).toBe(403);
});

test('the app’s own window is unaffected, Asset serving and the live-follow stream included', async ({ launch }) => {
  const run = await launch();

  // A 404 is the wall having let it reach the controller; a rejection would be 403 (ADR-0034).
  expect(await run.window.evaluate(() => fetch('/assets/nope/0123456789abcdef.png').then((r) => r.status))).toBe(404);

  // Aborted rather than read: an SSE stream never ends on its own (ADR-0044).
  expect(
    await run.window.evaluate(async () => {
      const abort = new AbortController();
      const res = await fetch('/api/events', { signal: abort.signal });
      const opened = { status: res.status, contentType: res.headers.get('content-type') };
      abort.abort();
      return opened;
    }),
  ).toEqual({ status: 200, contentType: expect.stringContaining('text/event-stream') });
});

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

function fetchRaw(origin: string, path: string, headers: Record<string, string>): Promise<RawResponse> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method: 'GET', headers }, (res) => {
      // Drained, or the socket stays open and the ordered quit waits on it.
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
