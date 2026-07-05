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

  // Landing on the World Index proves the cookie was set and the auth guard passed
  // (post-login default is the Index now — ADR-0028). Assert the route's own tab title,
  // not the greeting heading: a freshly-seeded user owns no worlds, so the Index shows its
  // empty state and the "Welcome back" header never renders. The title is set only after
  // authGuard resolves, so it proves both the landing and the auth in one world-count-independent check.
  await expect(page).toHaveTitle(/Worlds/);

  await page.context().storageState({ path: authFile });
});
