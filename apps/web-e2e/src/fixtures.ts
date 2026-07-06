import { test as base, expect, type Page, type Response } from '@playwright/test';

// ponytail: mirror of the app's pretty-URL codec (apps/web/.../core/utils/pretty-id.ts,
// ADR-0042) — the nx boundary rule forbids importing across projects, and the `slug-base62(id)`
// scheme is a frozen contract, so a tiny local copy is cheaper than promoting it to a lib.
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bare base62 code for a UUID (the suffix of a pretty segment). */
function codeOf(uuid: string): string {
  let n = BigInt('0x' + uuid.replace(/-/g, ''));
  if (n === 0n) return '0';
  let s = '';
  while (n > 0n) {
    s = B62[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s;
}

/** Recover the canonical UUID from a `slug-base62` (or legacy bare-UUID) segment. */
function idFromSegment(seg: string): string {
  if (UUID_RE.test(seg)) return seg;
  const code = seg.slice(seg.lastIndexOf('-') + 1);
  let n = 0n;
  for (const ch of code) {
    const i = B62.indexOf(ch);
    if (i < 0) return seg; // not base62 — pass through
    n = n * 62n + BigInt(i);
  }
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The base test for the authenticated suite. An auto fixture resets the database
 * to a clean slate (maps only) before each test via the e2e-only reset endpoint,
 * so no test ever sees another test's maps (ADR-0009). The reset keeps users and
 * sessions, so the shared login from `auth.setup.ts` survives it.
 *
 * This is a fixture, not a top-level `beforeEach`: a shared module is evaluated
 * once, so a top-level hook would register against only the first importer's
 * suite — an auto fixture runs per test regardless.
 *
 * The reset POST is intentionally unauthenticated and relies on `TestController`
 * having no guard, so it works even for the logged-out auth journey.
 */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({ request }, use) => {
      const res = await request.post('/api/test/reset');
      expect(res.ok()).toBeTruthy();
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * The open Entity's canonical id, decoded from the pretty URL segment (ADR-0042).
 * The last path segment is `slug-base62(id)`; specs need the raw id for testid
 * selectors (`open-<id>`) and `/api/entities/<id>` calls.
 */
export function entityIdFromUrl(page: Page): string {
  return idFromSegment(page.url().split('/').pop()!);
}

/**
 * A regex fragment matching a pretty URL segment (`slug-base62(id)` or bare code)
 * carrying `id` (ADR-0042). The base62 suffix is alnum-only, so it needs no escaping;
 * the `[^/]*` absorbs the optional cosmetic slug prefix.
 */
export function segRe(id: string): string {
  return `[^/]*${codeOf(id)}`;
}

/**
 * Wait for a successful entity PUT. Since the Save button is gone (ADR-0026),
 * this is used with Cmd/Ctrl+S to flush autosave immediately.
 */
export function waitForSave(page: Page): Promise<Response> {
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
}

/**
 * Flush a pending autosave and wait for it to commit (ADR-0026 — no Save button): press
 * Cmd/Ctrl+S, await the PUT, and confirm the status chip settles on 'Saved'. Returns the
 * PUT Response for the specs that read the saved payload straight off it.
 */
export async function flushSave(page: Page): Promise<Response> {
  const saved = waitForSave(page);
  await page.keyboard.press('ControlOrMeta+s');
  const res = await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  return res;
}

/**
 * Enter a reachable World's Entity browser via the World Index (ADR-0028). The
 * active World is a URL fact now (`/w/:worldId/entities`), not a remembered
 * selection, so a test reaches its library by choosing a World from the Index at
 * `/`. The seeded World always survives the entities-only reset (only Entities are
 * cleared, never Worlds), so the Index is never empty here. Returns the entered
 * World's id for specs that want to assert the URL scope.
 */
export async function enterLibrary(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByTestId(/^world-/).first().click();
  await page.waitForURL(/\/w\/[\w-]+\/entities$/);
  return page.url().match(/\/w\/([\w-]+)\/entities/)![1];
}
