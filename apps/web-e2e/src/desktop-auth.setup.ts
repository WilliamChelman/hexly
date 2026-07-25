import { expect, test as setup } from '@playwright/test';
import { authFileFor } from './auth-file';
import { TEST_USER } from './test-user';

/**
 * The desktop-profile run's session (ADR-0071, #318): posted straight to the login endpoint, because
 * this profile renders no login page to drive. `page.request` shares the browser context's cookie
 * jar, so the `Set-Cookie` lands in the persisted state — the Desktop App's minted-cookie shape
 * (ADR-0070) without an Electron build. The login endpoint is never on the Collaboration cut list,
 * which is why this works against a server that has Collaboration off too.
 */
setup('authenticate without a login page', async ({ page, baseURL }) => {
  const response = await page.request.post('/api/auth/login', {
    data: { email: TEST_USER.email, password: TEST_USER.password },
  });
  expect(response.ok()).toBeTruthy();

  // Same proof as the login-page setup: the World Index tab title, set only once authGuard resolves.
  await page.goto('/worlds');
  await expect(page).toHaveTitle(/Worlds/);

  await page.context().storageState({ path: authFileFor(new URL(baseURL!).port) });
});
