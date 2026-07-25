import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The Electron suite (ADR-0070, #320): the Desktop App launched as a real shell, asserting only facts that
 * cannot exist without one. Which affordances exist is a Deployment Profile or Collaboration question, and
 * the browser runs in `apps/web-e2e` answer those far more cheaply (ADR-0071, #316–#318) — nothing here
 * asserts either cut list.
 *
 * Run with `nx e2e desktop-e2e`, deliberately outside the everyday `nx e2e web-e2e` gate: this needs
 * `better-sqlite3` built for Electron's ABI (`pnpm native:electron`) and one `node_modules` holds one ABI,
 * so the two suites cannot share a working tree state, let alone a CI job.
 *
 * No `webServer`, because the shell hosts the API in its own main process.
 */
export default defineConfig({
  testDir: join(__dirname, 'src'),
  // One shell at a time: each launch holds an Instance's SQLite handle, and the second-launch fact needs
  // the only other process running to be the one it started.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  // A test boots Nest, runs migrations and opens a window — twice, for the relaunch fact.
  timeout: 180_000,
});
