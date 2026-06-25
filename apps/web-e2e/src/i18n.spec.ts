import { expect, test } from './fixtures';

/**
 * The language switcher works for any actor, so this exercises it logged out on
 * the login screen (ADR-0014). A clean slate — no session, no stored locale —
 * means the first visit reflects genuine default detection.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('defaults to English, flips to French live, and remembers it on reload', async ({
  page,
}) => {
  await page.goto('/login');

  // First visit with an English browser: the login screen renders in English.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();

  // Flip to French from the user menu's language group — live, no reload (ADR-0015).
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Français' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();

  // The choice persists across a reload.
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
