import { test as base, expect } from '@playwright/test';

/**
 * The base test for the authenticated suite. An auto fixture resets the database
 * to a clean slate (maps only) before each test via the e2e-only reset endpoint,
 * so no test ever sees another test's maps (ADR-0009). The reset keeps users and
 * sessions, so the shared login from `auth.setup.ts` survives it.
 *
 * This is a fixture, not a top-level `beforeEach`: a shared module is evaluated
 * once, so a top-level hook would register against only the first importer's
 * suite — an auto fixture runs per test regardless.
 */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({ request }, use) => {
      const res = await request.post('/api/test/reset');
      expect(res.ok()).toBeTruthy();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
