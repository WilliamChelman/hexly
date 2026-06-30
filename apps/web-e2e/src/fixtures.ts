import { test as base, expect, type Page, type Response } from '@playwright/test';

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
 * Tolerant by design for the TrailBase foundation slice (#128): there are no app
 * tables yet — Entities/Worlds become Record APIs in slice #3, which adds the real
 * `/test/reset` (a WASM route) alongside the data it has to clear. Until then the
 * reset is a best-effort no-op so the auth journey, which needs no truncation,
 * stays green.
 */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({ request }, use) => {
      await request.post('/api/test/reset').catch(() => undefined);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Wait for a successful entity PUT — shared across all persist specs. Since the Save
 * button is gone (ADR-0026), specs register this, then press `ControlOrMeta+s` to flush
 * the autosave immediately rather than waiting out the debounce.
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
