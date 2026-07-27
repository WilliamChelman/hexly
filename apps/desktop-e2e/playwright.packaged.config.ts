import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The post-package smoke check (#327): one launch of the artifact electron-builder produced, exercising what a
 * successful build cannot vouch for — a database opened, an image thumbnailed, a password hashed.
 *
 * Its own config rather than a project inside `playwright.config.ts`, because this needs a *package* and nothing
 * from the working tree's `node_modules`. `nx run desktop:package` runs it as its second command.
 */
export default defineConfig({
  testDir: join(__dirname, 'src', 'packaged'),
  // One shell at a time: a launch holds an Instance's SQLite handle and the single-instance lock.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Pinned as in apps/web-e2e, and suffixed so this run's artifacts sit beside the gate suite's rather
  // than overwriting them.
  outputDir: join(__dirname, 'test-results-packaged'),
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: join(__dirname, 'playwright-report-packaged') }], ['list']]
    : 'list',
  // A packaged launch boots Nest and runs migrations, then thumbnails through libvips.
  timeout: 180_000,
});
