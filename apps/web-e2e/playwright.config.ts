import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { authFile } from './src/auth-file';
import { TEST_USER, TEST_USERS } from './src/test-user';

// `__dirname` (not `import.meta`) because Playwright loads this config as CommonJS.
const workspaceRoot = join(__dirname, '..', '..');
// A dedicated port so e2e never collides with (or accidentally reuses) a `pnpm
// dev` server on 3000 — that server has a different, unseeded DB.
const port = process.env.E2E_PORT ?? '3100';
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

/**
 * E2E runs against the real production build on a single origin (ADR-0008,
 * ADR-0009, ADR-0032): `e2e-server.mjs` seeds a throwaway TrailBase depot and
 * boots one TrailBase process that serves both the API and the built SPA. Serial
 * (`workers: 1`) because the suite shares one depot and resets it between tests.
 */
export default defineConfig({
  testDir: join(__dirname, 'src'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // Logs in once and saves the session; the authenticated suite depends on it.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: authFile },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'node apps/web-e2e/e2e-server.mjs',
    url: baseURL,
    cwd: workspaceRoot,
    // Always start a fresh server so each run gets a freshly seeded throwaway DB;
    // opt into reuse locally (never in CI) with E2E_REUSE_SERVER=1 for fast iteration.
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER === '1',
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: port,
      E2E_USER_EMAIL: TEST_USER.email,
      E2E_USER_PASSWORD: TEST_USER.password,
      E2E_USER_NAME: TEST_USER.displayName,
      // Every role the sharing slice (#131) drives the Record APIs as. The server
      // `trail user add`s each; the specs log in via TrailBase's JSON auth.
      E2E_USERS: JSON.stringify(TEST_USERS),
    },
  },
});
