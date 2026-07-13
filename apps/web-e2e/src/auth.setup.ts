import { expect, test as setup } from '@playwright/test';
import { authFile } from './auth-file';
import { TEST_USER } from './test-user';

/** Log in once through the real UI and persist the session for the authenticated suite (ADR-0009). */
setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USER.email);
  await page.getByLabel('Password').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Assert the World Index tab title, not its greeting heading: a user who owns no worlds gets the
  // empty state and no "Welcome back" header. The title is set only after authGuard resolves, so it
  // proves the landing and the auth regardless of world count.
  await expect(page).toHaveTitle(/Worlds/);

  await page.context().storageState({ path: authFile });
});
