import {
  MONSTER_PACK_INSTALL,
  MONSTER_PACK_STATUS,
  enterEntities,
  entitiesRailLink,
  entityIdFromUrl,
  expect,
  installedPackId,
  libraryRailLink,
  mountContainer,
  openEntityActions,
  test,
} from '../fixtures';
// The pretty-URL codec (ADR-0042), imported by path like the other framework-free e2e utils.
import { idFromSegment } from '../../../../libs/web-core/src/utils/pretty-id';

/**
 * `features.collaboration: false` end-to-end via its own server (ADR-0071; server in
 * `playwright.config.ts`). The profile stays `server`: the flag cuts sharing, not authentication.
 * The account is Sole-User-shaped, so no absence below can be a role check's doing. Enabled
 * companions: `entity-grants.spec.ts` and `visibility-open.spec.ts`.
 */

test('Collaboration off: an Entity carries no sharing affordance, and the routes behind them 404', async ({
  page,
  request,
}) => {
  const res = await request.get('/api/config');
  expect(res.ok()).toBeTruthy();
  const config = await res.json();
  expect(config.collaboration).toBe(false);
  // Two independent knobs (ADR-0071): Collaboration is off, but this is still a server.
  expect(config.profile).toBe('server');

  await enterEntities(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);

  // The opener is the Sole User (World Owner), so the Pin toggle proves the menu is reachable; type
  // management moved off it to the Details panel (ADR-0067, #438).
  await openEntityActions(page);
  await expect(page.getByTestId('pin-toggle')).toBeVisible();
  await expect(page.getByTestId('manage-owners')).toHaveCount(0);
  // The three-way Visibility control (ADR-0084) needs the Collaboration layer that reads the column.
  await expect(page.getByTestId('visibility-set-private')).toHaveCount(0);
  await expect(page.getByTestId('visibility-set-shared')).toHaveCount(0);
  await expect(page.getByTestId('visibility-set-open')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Located by component, not by an inner testid: the sets share `add-select`, so a testid absence
  // proves less. The dialog's own gate is covered in its unit spec.
  await expect(page.locator('app-owner-set')).toHaveCount(0);
  await expect(page.locator('app-grant-set')).toHaveCount(0);

  await entitiesRailLink(page).click();
  await expect(page.getByTestId('facet-heading-type')).toBeVisible();
  await expect(page.getByTestId('facet-heading-visibility')).toHaveCount(0);
  await expect(page.getByTestId('facet-visibility-private')).toHaveCount(0);

  // Visibility is left inert (ADR-0071): the column still carries the schema default.
  const detail = await request.get(`/api/entities/${id}`);
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).visibility).toBe('private');

  // Enforced, not merely hidden (#315).
  expect((await request.get(`/api/entities/${id}/owners`)).status()).toBe(404);
});

test('Collaboration off: World Settings keeps its schema and imports groups and loses access and sharing', async ({
  page,
  request,
}) => {
  const worldSeg = await enterEntities(page);
  await page.goto(`/w/${worldSeg}/settings`);

  await expect(page.getByTestId('settings-nav-schema')).toBeVisible();
  await expect(page.getByTestId('settings-nav-imports')).toBeVisible();
  await expect(page.getByTestId('settings-nav-access')).toHaveCount(0);
  // The sharing group is the Open-World toggle (ADR-0084), cut with the Collaboration layer.
  await expect(page.getByTestId('settings-nav-sharing')).toHaveCount(0);
  await expect(page.locator('app-world-open')).toHaveCount(0);
  await expect(page.locator('app-world-types')).toBeVisible();

  // Both mount in the group Settings opens on when Collaboration is on, so their absence is the flag's.
  await expect(page.locator('app-owner-set')).toHaveCount(0);
  await expect(page.locator('app-member-set')).toHaveCount(0);

  // Imports is not sharing, so the group survives the flag — it simply lists no Compendium Importer,
  // here as anywhere: a pack is stocked from the admin area (#404), not from World Settings.
  await page.getByTestId('settings-nav-imports').click();
  await expect(page.getByTestId('importer-draw-steel.importer.monsters')).toHaveCount(0);

  // Enforced too (#315): member management 404s with the layer off, and the retired Public Link
  // routes (ADR-0084) 404 as a family — server-side and, on the web, as no route at all.
  const worldId = idFromSegment(worldSeg);
  expect((await request.get(`/api/worlds/${worldId}/members`)).status()).toBe(404);
  expect((await request.get(`/api/worlds/${worldId}/link`)).status()).toBe(404);
  expect((await request.get(`/api/public/worlds/some-token`)).status()).toBe(404);
  // The former `/public/**` URLs are no route now (ADR-0084): a signed-in caller lands on the error
  // page rather than a shared read, the address left visible rather than papered over.
  for (const url of ['/public/w/some-token', '/public/e/some-token', '/public/w/some-token/e/some-entity']) {
    await page.goto(url);
    await expect(page.getByTestId('error-home')).toBeVisible();
  }
});

test('Collaboration off: user management is unreachable by route, rail or Palette, and the Reindex still runs', async ({
  page,
  request,
}) => {
  await page.goto('/worlds');
  // This account holds manage-users *and* Superadmin, so only the Collaboration flag can drop Users.
  await expect(page.getByTestId('nav-admin')).toBeVisible();
  await expect(page.getByTestId('nav-users')).toHaveCount(0);

  // The Palette entry ADR-0071 names as the trap.
  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByTestId('command-palette-input').fill('>go');
  await expect(page.getByTestId('command-palette-option-go-admin')).toBeVisible();
  await expect(page.getByTestId('command-palette-option-go-users')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Enforced by route and API, not merely hidden (#315).
  await page.goto('/users');
  await expect(page).toHaveURL(/\/worlds$/);
  await expect(page.getByTestId('create-user')).toHaveCount(0);
  expect((await request.get('/api/users')).status()).toBe(404);

  // The Reindex is on neither cut list (ADR-0037).
  await page.getByTestId('nav-admin').click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByTestId('reindex').click();
  await expect(page.locator('.toast', { hasText: 'Reindexed' })).toBeVisible();
});

test('Collaboration off: a pack is stocked, Mounted and read through the Library unchanged', async ({ page }) => {
  // The shelf and the sharing switch are independent (ADR-0079, story 39), and so is Mounting: a Sole
  // User declares what a World draws from with no sharing concepts in sight (ADR-0071, ADR-0080). This
  // account is its own operator, which is what makes the distinction invisible on a single-user
  // Instance rather than absent from it.
  await page.goto('/admin');
  await page.getByTestId(MONSTER_PACK_INSTALL).click();
  await expect(page.getByTestId(MONSTER_PACK_STATUS)).toContainText('2 entries', { timeout: 15_000 });

  const worldSeg = await enterEntities(page);
  await mountContainer(page, worldSeg, await installedPackId(page));
  await libraryRailLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/library$`));
  await expect(page.getByText('Goblin Warrior', { exact: true })).toBeVisible();
});
