import { expect, test } from './fixtures';

/**
 * The language switcher works for any actor (ADR-0014), now behind the rail's
 * avatar (ADR-0022). Login itself is standalone with no rail, so an anonymous
 * actor flips the language from the reduced rail on a public page (the
 * styleguide) and the choice carries over to login. A clean slate — no session,
 * no stored locale — means the first visit reflects genuine default detection.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('defaults to English, flips to French via the rail, and remembers it on reload', async ({
  page,
}) => {
  // The login screen renders in English on a first visit with an English browser.
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();

  // Flip to French from the rail avatar on a public page (login has no rail).
  await page.goto('/styleguide');
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Français' }).click();

  // The choice carries to the standalone login screen and persists on reload.
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
});

test.describe('with a French browser', () => {
  test.use({ locale: 'fr-FR', storageState: { cookies: [], origins: [] } });

  test('picks French on the first visit', async ({ page }) => {
    await page.goto('/login');

    await expect(
      page.getByRole('button', { name: 'Se connecter' }),
    ).toBeVisible();
  });
});
