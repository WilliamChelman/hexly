import { expect, test } from './fixtures';
import { TEST_USER } from './test-user';

/**
 * Starts logged out: signing out deletes the session row server-side, so reusing the
 * suite's stored session here would invalidate every other test's cookie (ADR-0009).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('guards the app, signs in, and signs out', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  // Login renders standalone — no nav rail (ADR-0022).
  await expect(page.getByTestId('nav-rail')).toHaveCount(0);

  await page.getByLabel('Email').fill(TEST_USER.email);
  await page.getByLabel('Password').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The returnUrl carries us back to the gated page we were headed to — the World
  // Index at /worlds, which `/` redirects to (ADR-0028).
  await expect(page).toHaveURL(/\/worlds$/);
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

  // Sign out returns to /login (the action lives behind the rail avatar, ADR-0022).
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  // The desktop profile's dead end is no destination here: a server has a login page (ADR-0071).
  await page.goto('/session-error');
  await expect(page).toHaveURL(/\/login/);
});
