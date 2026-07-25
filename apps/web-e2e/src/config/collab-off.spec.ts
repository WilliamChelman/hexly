import { enterLibrary, entityIdFromUrl, expect, openEntityActions, test } from '../fixtures';
// The pretty-URL codec (ADR-0042), imported by path like the other framework-free e2e utils:
// `enterLibrary` yields the URL's `slug-base62` segment, but the API keys on the raw id.
import { idFromSegment } from '../../../../libs/web-core/src/utils/pretty-id';

/**
 * `features.collaboration: false` end-to-end via its own server, booted against a written `hexly.yml`
 * (ADR-0071; server in `playwright.config.ts`). The profile stays `server`, so this run logs in through
 * the login page like every other — the flag cuts sharing, not authentication. Enabled companions:
 * `entity-grants.spec.ts` and `public-link.spec.ts`.
 *
 * The account is Sole-User-shaped — Superadmin holding every Instance Role (ADR-0071) — so no absence
 * below can be a role check's doing, and the Reindex, on neither cut list, is still there to assert.
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

  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);

  // The menu still opens — Edit types and Pin are not sharing — but offers neither Share nor
  // Visibility. The opener is the Sole User, so a Rights or Instance-Role check would read true here.
  await openEntityActions(page);
  await expect(page.getByTestId('edit-types')).toBeVisible();
  await expect(page.getByTestId('manage-owners')).toHaveCount(0);
  await expect(page.getByTestId('visibility-toggle')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // With no menu entry left to open it, the whole page carries no owner set, grant set or Public Link.
  // The dialog's own gate — it refuses to mount even asked to — is covered in its unit spec. Located by
  // component, not by an inner testid: the sets share `add-select`, so a testid absence proves less.
  await expect(page.locator('app-owner-set')).toHaveCount(0);
  await expect(page.locator('app-grant-set')).toHaveCount(0);
  await expect(page.locator('app-public-link')).toHaveCount(0);
  await expect(page.getByTestId('public-link-create')).toHaveCount(0);

  // The Entity Browser keeps its Type/Tag facets and drops the Visibility one.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page.getByTestId('facet-heading-type')).toBeVisible();
  await expect(page.getByTestId('facet-heading-visibility')).toHaveCount(0);
  await expect(page.getByTestId('facet-visibility-private')).toHaveCount(0);

  // Visibility is left inert (ADR-0071): the column still carries the schema default.
  const detail = await request.get(`/api/entities/${id}`);
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).visibility).toBe('private');

  // Enforced, not merely hidden (#315): the owner set is one of the gated routes.
  expect((await request.get(`/api/entities/${id}/owners`)).status()).toBe(404);
});

test('Collaboration off: World Settings keeps its schema and imports groups and loses access and sharing', async ({
  page,
  request,
}) => {
  const worldSeg = await enterLibrary(page);
  await page.goto(`/w/${worldSeg}/settings`);

  // The in-page rail: schema and imports survive, the Owner/member group and the World Public Link go,
  // and the page opens on the first surviving group rather than a blank detail pane.
  await expect(page.getByTestId('settings-nav-schema')).toBeVisible();
  await expect(page.getByTestId('settings-nav-imports')).toBeVisible();
  await expect(page.getByTestId('settings-nav-access')).toHaveCount(0);
  await expect(page.getByTestId('settings-nav-sharing')).toHaveCount(0);
  await expect(page.locator('app-world-types')).toBeVisible();

  // No owner set and no member set: both mount in the group Settings opens on when Collaboration is
  // on, so their absence here is the flag's doing. The World Public Link's only way in is the sharing
  // group asserted gone above.
  await expect(page.locator('app-owner-set')).toHaveCount(0);
  await expect(page.locator('app-member-set')).toHaveCount(0);

  // The Imports group survives whole, minus the one Visibility choice it used to carry (ADR-0071).
  await page.getByTestId('settings-nav-imports').click();
  await expect(page.getByTestId('importer-draw-steel.importer.monsters')).toBeVisible();
  await expect(page.getByTestId('importer-run-draw-steel.importer.monsters')).toBeVisible();
  await expect(page.getByTestId('importer-visibility-draw-steel.importer.monsters')).toHaveCount(0);

  // Enforced too (#315), and no token route a link would hand out is a destination either.
  const worldId = idFromSegment(worldSeg);
  expect((await request.get(`/api/worlds/${worldId}/members`)).status()).toBe(404);
  expect((await request.get(`/api/worlds/${worldId}/link`)).status()).toBe(404);
  for (const url of ['/public/w/some-token', '/public/e/some-token', '/public/w/some-token/e/some-entity']) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/worlds$/);
  }
});

test('Collaboration off: user management is unreachable by route, rail or Palette, and the Reindex still runs', async ({
  page,
  request,
}) => {
  await page.goto('/worlds');
  // Outside a World the rail shows its instance destinations (ADR-0041). This account holds
  // manage-users *and* Superadmin, so only the Collaboration flag can be dropping Users.
  await expect(page.getByTestId('nav-admin')).toBeVisible();
  await expect(page.getByTestId('nav-users')).toHaveCount(0);

  // The Command Palette's navigation Commands: the trap ADR-0071 names. Go to Admin stays.
  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByTestId('command-palette-input').fill('>go');
  await expect(page.getByTestId('command-palette-option-go-admin')).toBeVisible();
  await expect(page.getByTestId('command-palette-option-go-users')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Typed in directly, the route bounces and the roster never mounts; the API agrees (#315).
  await page.goto('/users');
  await expect(page).toHaveURL(/\/worlds$/);
  await expect(page.getByTestId('create-user')).toHaveCount(0);
  expect((await request.get('/api/users')).status()).toBe(404);

  // The Superadmin Reindex is on neither cut list (ADR-0037): reachable, and it still walks.
  await page.getByTestId('nav-admin').click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByTestId('reindex').click();
  await expect(page.locator('.toast', { hasText: 'Reindexed' })).toBeVisible();
});
