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
  // Unauthenticated: the World Index at / is gated, so the guard bounces to /login.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  // Login renders standalone — no nav rail (ADR-0022).
  await expect(page.getByTestId('nav-rail')).toHaveCount(0);

  await page.getByLabel('Email').fill(TEST_USER.email);
  await page.getByLabel('Password').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The returnUrl carries us back to the gated page we were headed to — the Index.
  // We assert the authed shell (the nav rail) rather than World content: Worlds
  // are still on `/api/...` this slice (#128) and return to TrailBase in #3, so
  // the rail is the durable "we're signed in and inside the app" signal.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('nav-rail')).toBeVisible();

  // Session survives a reload: the stored tokens re-authenticate on boot rather
  // than bouncing back to /login (ADR-0032 — short-lived JWT + refresh token).
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('nav-rail')).toBeVisible();

  // Sign out returns to /login (the action lives behind the rail avatar, ADR-0022)...
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  // ...and the guard blocks the app again.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
