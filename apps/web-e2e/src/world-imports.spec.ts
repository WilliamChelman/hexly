import { enterLibrary, expect, test } from './fixtures';
import { TEST_GRANTEE } from './test-user';
// The pretty-URL codec (ADR-0042), imported by path like the other framework-free e2e utils in
// fixtures.ts: `enterLibrary` yields the URL's `slug-base62` segment, but the API keys on the raw id.
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * The generic World Imports panel (ADR-0060), end-to-end on a single origin (ADR-0009). The Draw
 * Steel `draw-steel.importer.monsters` Importer's codeload fetch port (ADR-0061) is swapped for its committed
 * Ajax + Goblin fixtures under the e2e opt-in (`E2eFixtureImporters`), so a real run stays offline
 * and deterministic: two fixtures land as two Entities and the run summary reports them.
 */

const MONSTERS_ROW = 'importer-draw-steel.importer.monsters';
const MONSTERS_RUN = 'importer-run-draw-steel.importer.monsters';
const MONSTERS_STATUS = 'importer-status-draw-steel.importer.monsters';

test('a World Owner runs the fixture-backed Draw Steel import and sees the run summary', async ({ page }) => {
  const worldId = await enterLibrary(page);
  await page.goto(`/w/${worldId}/settings`);
  await page.getByTestId('settings-nav-imports').click();

  // The Draw Steel Importer is listed under its plugin-supplied, transloco-resolved label (#260).
  await expect(page.getByTestId(MONSTERS_ROW)).toBeVisible();
  await expect(page.getByTestId(MONSTERS_RUN)).toBeVisible();

  // Trigger the (fixture-backed, offline) import: the run returns 202 up front and the panel then
  // polls the reconcile home (ADR-0060), so arm the response wait before the click.
  const started = page.waitForResponse(
    (r) =>
      /\/api\/worlds\/[\w-]+\/importers\/draw-steel\.importer\.monsters\/run$/.test(r.url()) &&
      r.request().method() === 'POST' &&
      r.status() === 202,
  );
  await page.getByTestId(MONSTERS_RUN).click();
  await started;

  // The run summary renders once the reconcile lands: the Ajax + Goblin fixtures → 2 Entities.
  await expect(page.getByTestId(MONSTERS_STATUS)).toContainText('2 entities', { timeout: 15_000 });
});

test('a reachable non-Owner cannot import: no run trigger in the UI, and the server refuses a direct run', async ({
  page,
  browser,
}) => {
  // The Owner's session yields a World, and grants the second user *reach* into it as a Viewer — the
  // interesting boundary is a reader who is still not an Owner (403), not a stranger who can't see the
  // World at all (404). The Access section is Settings' default pane.
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg); // the raw id the API keys on, decoded from the pretty segment
  await page.goto(`/w/${worldSeg}/settings`);
  // Owner-set and member-set share `add-select`/`add` testids, so scope to the member controls.
  const memberAdd = page.locator('app-member-set');
  await memberAdd.getByTestId('add-select').selectOption({ label: TEST_GRANTEE.displayName });
  await memberAdd.getByTestId('add-role').selectOption('viewer');
  const memberAdded = page.waitForResponse(
    (r) => /\/api\/worlds\/[\w-]+\/members$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await memberAdd.getByTestId('add').click();
  await memberAdded;

  // The Viewer logs in through the real UI, in their own cookie-less context (overriding the project's
  // authenticated default).
  const otherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await otherContext.newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill(TEST_GRANTEE.email);
  await other.getByLabel('Password').fill(TEST_GRANTEE.password);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other).toHaveTitle(/Worlds/);

  // The Settings shell renders for any reader, but every Importer surface is Owner-gated server-side
  // (ADR-0039, ADR-0060): the panel's list load is refused, so it settles on its empty state and
  // affords no run trigger. Reach it and positively establish both facts.
  await other.goto(`/w/${worldSeg}/settings`);
  await other.getByTestId('settings-nav-imports').click();
  await expect(other.getByText('No importers available.')).toBeVisible();
  await expect(other.getByTestId(MONSTERS_RUN)).toHaveCount(0);

  // The UI gate is only cosmetic, so prove the boundary at the API: a direct run from the Viewer's own
  // session (its context's cookies) is refused with 403 — reachable, but not an Owner (ADR-0060).
  const refused = await otherContext.request.post(`/api/worlds/${worldId}/importers/draw-steel.importer.monsters/run`, {
    data: { visibility: 'shared' },
  });
  expect(refused.status()).toBe(403);

  await otherContext.close();
});
