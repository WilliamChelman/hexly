import { expect, test } from './fixtures';
import { TEST_USER } from './test-user';

/**
 * The auth journey owns its session: it signs in and then signs out, which
 * deletes the session row server-side. Sharing the suite's stored session would
 * invalidate every other test's reused cookie, so this starts logged out
 * (ADR-0009).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('guards the app, signs in, and signs out', async ({ page }) => {
  // Unauthenticated: the library is gated, so the guard bounces to /login.
  await page.goto('/entities');
  await expect(page).toHaveURL(/\/login/);

  // Login renders standalone — no nav rail (ADR-0022).
  await expect(page.getByTestId('nav-rail')).toHaveCount(0);

  await page.getByLabel('Email').fill(TEST_USER.email);
  await page.getByLabel('Password').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The returnUrl carries us back to the gated page we were headed to.
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();

  // Sign out returns to /login (the action lives behind the rail avatar, ADR-0022)...
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  // ...and the guard blocks the app again.
  await page.goto('/entities');
  await expect(page).toHaveURL(/\/login/);
});
