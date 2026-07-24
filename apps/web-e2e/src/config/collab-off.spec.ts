import { enterLibrary, entityIdFromUrl, expect, openEntityActions, test } from '../fixtures';

/**
 * `features.collaboration: false` end-to-end via its own server, booted against a written `hexly.yml`
 * (ADR-0071; server in `playwright.config.ts`). The profile stays `server`, so this run logs in through
 * the login page like every other — the flag cuts sharing, not authentication. Enabled companions:
 * `entity-grants.spec.ts` and `public-link.spec.ts`.
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
  // The dialog's own gate — it refuses to mount even asked to — is covered in its unit spec.
  await expect(page.getByTestId('owner-add-select')).toHaveCount(0);
  await expect(page.getByTestId('grant-add-select')).toHaveCount(0);
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
