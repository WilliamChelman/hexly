import { enterLibrary, expect, test } from './fixtures';
import { TEST_GRANTEE } from './test-user';

/**
 * The generic World Imports panel (ADR-0060), end-to-end on a single origin (ADR-0009). The Draw
 * Steel `draw-steel.monsters` Importer's codeload fetch port (ADR-0061) is swapped for its committed
 * Ajax + Goblin fixtures under the e2e opt-in (`E2eFixtureImporters`), so a real run stays offline
 * and deterministic: two fixtures land as two Entities and the run summary reports them.
 */

const MONSTERS_ROW = 'importer-draw-steel.monsters';
const MONSTERS_RUN = 'importer-run-draw-steel.monsters';
const MONSTERS_STATUS = 'importer-status-draw-steel.monsters';

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
      /\/api\/worlds\/[\w-]+\/importers\/draw-steel\.monsters\/run$/.test(r.url()) &&
      r.request().method() === 'POST' &&
      r.status() === 202,
  );
  await page.getByTestId(MONSTERS_RUN).click();
  await started;

  // The run summary renders once the reconcile lands: the Ajax + Goblin fixtures → 2 Entities.
  await expect(page.getByTestId(MONSTERS_STATUS)).toContainText('2 entities', { timeout: 15_000 });
});

test('a non-Owner does not see the Imports trigger', async ({ page, browser }) => {
  // The Owner's session yields a World to point a second, non-Owner user at.
  const worldId = await enterLibrary(page);

  // A second seeded user, in their own cookie-less context (overriding the project's authenticated
  // default), logs in through the real UI and opens the same World's Settings.
  const otherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const other = await otherContext.newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill(TEST_GRANTEE.email);
  await other.getByLabel('Password').fill(TEST_GRANTEE.password);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other).toHaveTitle(/Worlds/);

  // Reach the imports section if the owner-only Settings even renders for a non-Owner; whether it
  // does or bounces to the Index, the point holds: the import trigger is owner-gated (ADR-0039,
  // ADR-0060) and never reaches a non-Owner.
  await other.goto(`/w/${worldId}/settings`);
  const importsNav = other.getByTestId('settings-nav-imports');
  if (await importsNav.isVisible().catch(() => false)) {
    await importsNav.click();
  }
  await expect(other.getByTestId(MONSTERS_RUN)).toHaveCount(0);

  await otherContext.close();
});
