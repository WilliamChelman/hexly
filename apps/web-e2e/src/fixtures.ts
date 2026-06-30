import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type Response,
} from '@playwright/test';
import { TEST_USER } from './test-user';

/**
 * The base test for the authenticated suite. An auto fixture resets the database
 * to a clean slate before each test, so no test ever sees another test's data
 * (ADR-0009). The reset keeps the user, so the shared login from `auth.setup.ts`
 * survives it.
 *
 * This is a fixture, not a top-level `beforeEach`: a shared module is evaluated
 * once, so a top-level hook would register against only the first importer's
 * suite — an auto fixture runs per test regardless.
 *
 * Worlds/Entities are TrailBase Record APIs now (#129, ADR-0032), so the reset
 * runs over the wire rather than a NestJS test route: it mints a fresh token for
 * the seeded user (TrailBase auth is Bearer-token, not cookie, so the browser
 * session doesn't carry to `request`), deletes every World the user owns (the
 * `world_id` FK cascade drops each World's Entities — Home included), then mints
 * one fresh seed World. Every test thus starts from the same clean slate: a single
 * empty World whose only Entity is its Home note — so the World Index is never empty
 * (its greeting renders only with a World) and `enterLibrary` opens an empty
 * library. Best-effort: a failed reset (e.g. the logged-out auth journey) is
 * swallowed so tests that need no data still run.
 */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({ request }, use) => {
      await resetWorlds(request).catch(() => undefined);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** Mint a fresh auth token for the seeded e2e user via TrailBase's JSON login. */
async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/v1/login', {
    data: { email: TEST_USER.email, password: TEST_USER.password },
  });
  const body = (await res.json()) as { auth_token: string };
  return body.auth_token;
}

/** Clear the user's Worlds (cascading their Entities) and mint one seed World — the reset. */
async function resetWorlds(request: APIRequestContext): Promise<void> {
  const token = await login(request);
  const headers = { authorization: `Bearer ${token}` };
  const res = await request.get('/api/records/v1/worlds?limit=256', { headers });
  const { records } = (await res.json()) as { records: { id: string }[] };
  for (const w of records) {
    await request.delete(`/api/records/v1/worlds/${encodeURIComponent(w.id)}`, { headers });
  }
  // One seed World so the Index is never empty and enterLibrary has a World to open.
  await request.post('/api/records/v1/worlds', { headers, data: { name: 'Hexly' } });
}

/**
 * The token the running app holds (TrailBase stores it in localStorage, ADR-0032),
 * for specs that drive a Record API directly with the user's identity — e.g. the
 * World rename, which has no UI yet (its name is the source of truth, ADR-0029).
 */
export async function authToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('hexly.tb.session');
    return raw ? (JSON.parse(raw) as { auth_token: string }).auth_token : '';
  });
}

/**
 * Wait for a successful entity save. Save (optimistic concurrency, the `version`
 * UPDATE access-rule) returns in slice #4 (#129 covers reads/writes only), so the
 * persist/link specs that flush a save are quarantined here at the one chokepoint
 * they share — rather than annotating ~16 files — until #4 brings them back.
 */
export function waitForSave(page: Page): Promise<Response> {
  test.skip(true, 'Save/concurrency returns in slice #4 (#129).');
  return page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && res.ok(),
  );
}

/** Flush a pending autosave and wait for it to commit. Quarantined with {@link waitForSave}. */
export async function flushSave(page: Page): Promise<Response> {
  const saved = waitForSave(page);
  await page.keyboard.press('ControlOrMeta+s');
  const res = await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  return res;
}

/**
 * Enter the seeded World's Entity browser via the World Index (ADR-0028). The active
 * World is a URL fact (`/w/:worldId/entities`), so a test reaches its library by
 * choosing a World from the Index at `/`. The reset leaves exactly one empty seed
 * World, so the browser opens on an empty library — the Home Entity is the World's
 * landing page, not a library card (ADR-0024). Returns the entered World's id
 * (decoded) for URL-scope assertions.
 */
export async function enterSeedLibrary(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByTestId(/^world-/).first().click();
  await page.waitForURL(/\/w\/[^/]+\/entities$/);
  return decodeURIComponent(page.url().match(/\/w\/([^/]+)\/entities/)![1]);
}

/**
 * The quarantined library entry. #129 restored Worlds/Entities reads/writes
 * (entity-browser.spec enters via {@link enterSeedLibrary}), but the persist / link /
 * select / move specs exercise saving and editing features that return on TrailBase
 * in later slices (#4 save + optimistic concurrency, #5 sharing + Entity Links). They
 * all enter here, so they skip from this one chokepoint rather than ~30 per-file
 * annotations. Delete the skip per spec as each slice migrates it back.
 */
export async function enterLibrary(page: Page): Promise<string> {
  test.skip(true, 'Map persist / links / selection return on TrailBase in slices #4–#5.');
  return enterSeedLibrary(page);
}
