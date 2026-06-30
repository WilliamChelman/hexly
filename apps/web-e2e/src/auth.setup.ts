import { expect, test as setup } from '@playwright/test';
import { authFile } from './auth-file';
import { TEST_USER } from './test-user';

/**
 * Log in once through the real UI and persist the session, so the authenticated
 * suite starts signed in instead of re-logging in per test (ADR-0009). Uses the
 * base test (no DB reset): logging in only reads the seeded user.
 */
setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USER.email);
  await page.getByLabel('Password').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Landing in the authed shell (the nav rail) proves the session was stored and
  // the auth guard passed. We don't assert World content: Worlds are still on
  // `/api/...` this slice (#128) and return to TrailBase in #3.
  await expect(page.getByTestId('nav-rail')).toBeVisible();

  await page.context().storageState({ path: authFile });
});
