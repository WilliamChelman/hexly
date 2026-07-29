import {
  MONSTER_PACK_INSTALL,
  MONSTER_PACK_REMOVE,
  MONSTER_PACK_ROW,
  MONSTER_PACK_STATUS,
  enterEntities,
  expect,
  signInOperator,
  test,
} from './fixtures';

/**
 * Stocking the Instance's shelf (ADR-0079, #404), end-to-end on a single origin (ADR-0009). A
 * compendium pack is Instance-wide, so it is installed from the admin area by the **operator** and
 * from nowhere else — the World Owner's Imports panel does not list one. The Draw Steel
 * `draw-steel.importer.monsters` pack's codeload fetch port (ADR-0061) is swapped for its committed
 * Ajax + Goblin fixtures under the e2e opt-in (`E2eFixtureImporters`), so a real run stays offline
 * and deterministic: two fixtures land as two entries and the panel says so.
 *
 * The surface's own cases — the refusals, the 409, the identity-preserving reimport — live at the
 * HTTP seam in `compendium-packs.controller.spec.ts`. What only a browser shows is that the operator
 * has a front door and a World Owner does not.
 */

test('the operator installs the fixture-backed Draw Steel pack, sees its pinned revision, and removes it', async ({
  browser,
}) => {
  const operator = await signInOperator(browser);
  await operator.goto('/admin');

  // The pack is listed under its plugin-supplied, transloco-resolved label.
  await expect(operator.getByTestId(MONSTER_PACK_ROW)).toContainText('Draw Steel — Monsters');

  // Trigger the (fixture-backed, offline) install: the run returns 202 up front and the panel then
  // polls the reconcile home (ADR-0060), so arm the response wait before the click. Idempotent, so
  // this journey reads the same whether an earlier spec left the shelf stocked or not.
  const started = operator.waitForResponse(
    (r) =>
      r.url().endsWith('/api/admin/compendiums/draw-steel.importer.monsters/run') &&
      r.request().method() === 'POST' &&
      r.status() === 202,
  );
  await operator.getByTestId(MONSTER_PACK_INSTALL).click();
  await started;

  // Once the reconcile lands the row states what is on the shelf, at which revision — the answer to
  // "which version of the bestiary is this" (story 34).
  await expect(operator.getByTestId(MONSTER_PACK_STATUS)).toContainText('2 entries', { timeout: 15_000 });
  await expect(operator.getByTestId(MONSTER_PACK_STATUS)).toContainText('Revision');
  // Installed, so the action reads as a reimport rather than a first install.
  await expect(operator.getByTestId(MONSTER_PACK_INSTALL)).toContainText('Reimport');

  // Removal is the other half of the same panel: the shelf empties and the pack is offered afresh.
  // It states its blast radius first (#414) — nothing points into this pack, said in words — and is
  // refused by nothing it finds.
  await operator.getByTestId(MONSTER_PACK_REMOVE).click();
  await expect(operator.getByTestId('pack-remove-links')).toContainText('Nothing points into this pack');
  await operator.getByTestId('confirm-pack-remove').click();
  await expect(operator.getByTestId(MONSTER_PACK_ROW)).toContainText('Not installed');
  await expect(operator.getByTestId(MONSTER_PACK_INSTALL)).toContainText('Install');
  await expect(operator.getByTestId(MONSTER_PACK_REMOVE)).toHaveCount(0);

  await operator.context().close();
});

test('a World Owner is offered no pack: not in World Settings, and not at the admin door', async ({ page }) => {
  const worldSeg = await enterEntities(page);

  // The Imports panel is the World Owner's own, and lists only what reconciles into a World. With no
  // such Importer enabled it is empty — the bestiary is not hidden here, it was never this surface's.
  await page.goto(`/w/${worldSeg}/settings`);
  await page.getByTestId('settings-nav-imports').click();
  await expect(page.getByText('No importers available.')).toBeVisible();
  await expect(page.getByTestId('importer-run-draw-steel.importer.monsters')).toHaveCount(0);

  // The admin area is not a destination they have, and the route bounces rather than rendering it.
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);

  // The UI gate is only cosmetic, so prove the boundary at the API: a direct install from the World
  // Owner's own session is refused — stocking the Instance's shelf is the operator's (ADR-0079).
  const refused = await page.request.post('/api/admin/compendiums/draw-steel.importer.monsters/run');
  expect(refused.status()).toBe(403);
});
