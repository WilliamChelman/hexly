import {
  test as base,
  expect,
  type APIRequestContext,
  type APIResponse,
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
 * The persisted Entity body as the specs drill into it (ADR-0019 keeps it opaque to the
 * domain, but a test asserts on concrete fields). Loosely typed like the raw JSON it is.
 */
interface PersistedDocument {
  type: string;
  content: { format: string; snapshot: unknown };
  hexes: Record<
    string,
    { terrain: string; name?: string; entityId?: string; feature?: { ref: string; entityId?: string } }
  >;
  regions: Record<string, unknown>[];
  labels: Record<string, unknown>[];
}

/** A persisted Entity read straight off the wire — `document` parsed, `tags` decoded. */
interface PersistedEntity {
  readonly res: APIResponse;
  readonly document: PersistedDocument;
  readonly tags: string[];
}

/**
 * Read an Entity directly from the TrailBase `entities` Record API as the seeded user
 * (ADR-0009 independent-channel proof that a save persisted; ADR-0032). Replaces the
 * retired NestJS `GET /api/entities/:id`. `id` is the percent-encoded id taken from the
 * page URL — it rides the path as-is. `document` is a jsonschema JSON column (#130) so it
 * arrives already parsed; `tags` is a JSON string, decoded here.
 */
export async function readEntity(
  page: Page,
  request: APIRequestContext,
  id: string,
): Promise<PersistedEntity> {
  const res = await request.get(`/api/records/v1/entities/${id}`, {
    headers: { authorization: `Bearer ${await authToken(page)}` },
  });
  if (!res.ok()) throw new Error(`readEntity ${id}: HTTP ${res.status()}`);
  const row = (await res.json()) as { document: PersistedEntity['document']; tags?: string };
  return { res, document: row.document, tags: JSON.parse(row.tags ?? '[]') as string[] };
}

/**
 * Wait for a successful entity save. Save + optimistic concurrency (the `version`
 * UPDATE access-rule) landed in slice #4 (#130), so this no longer quarantines — it
 * waits for the PATCH the autosave/flush emits. The conflict path returns
 * `{status:'conflict'}` client-side, not a failed PATCH, so `res.ok()` still holds.
 */
export function waitForSave(page: Page): Promise<Response> {
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
 * Library entry for the map persist / selection / move specs. Slice #4 (#130) brought
 * save + optimistic concurrency back, lifting the blanket quarantine that lived here —
 * this is now a thin alias for {@link enterSeedLibrary}. The Entity Link specs that still
 * need slice #5 (sharing + Entity Links + the descriptor index) carry their own per-file
 * {@link quarantineSlice5} skip instead.
 */
export async function enterLibrary(page: Page): Promise<string> {
  return enterSeedLibrary(page);
}

/**
 * Per-file skip for the Entity Link journeys (#76/#78/#95/#96): they exercise link
 * resolution, the `@`/`::` pickers, and the server descriptor index — all slice #5,
 * not yet on TrailBase. Call it first in each such spec; drop it as #5 migrates them.
 */
export function quarantineSlice5(): void {
  test.skip(true, 'Entity Links + descriptor index return on TrailBase in slice #5.');
}
