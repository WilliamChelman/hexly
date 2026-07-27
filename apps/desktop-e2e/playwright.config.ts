import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The Electron suite (ADR-0070, #320): only facts that cannot exist without a real shell — cut lists belong to
 * the cheaper browser runs in `apps/web-e2e` (ADR-0071, #316–#318).
 *
 * Outside the everyday `nx e2e web-e2e` gate: this needs `better-sqlite3` built for Electron's ABI
 * (`pnpm native:electron`) and one `node_modules` holds one ABI. No `webServer`, since the shell hosts the API
 * in its own main process.
 */
export default defineConfig({
  testDir: join(__dirname, 'src'),
  // The packaged smoke check needs an artifact this gate does not build (`playwright.packaged.config.ts` owns it).
  testIgnore: '**/packaged/**',
  // One shell at a time: each launch holds an Instance's SQLite handle, and the second-launch fact needs the
  // only other process running to be the one it started.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Pinned as in apps/web-e2e: Playwright would resolve these to the workspace root.
  outputDir: join(__dirname, 'test-results'),
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: join(__dirname, 'playwright-report') }], ['list']]
    : 'list',
  // A test boots Nest, runs migrations and opens a window — twice, for the relaunch fact.
  timeout: 180_000,
});
