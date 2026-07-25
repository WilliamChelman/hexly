import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The post-package smoke check (#327): one launch of the artifact electron-builder produced, exercising the
 * things a successful build cannot vouch for — a database opened, an image thumbnailed, a password hashed.
 *
 * Its own config rather than a project inside `playwright.config.ts`, because the input is different in kind:
 * the suite next door launches `dist/apps/desktop/main.js` and needs the working tree's `node_modules` on
 * Electron's ABI, while this needs a *package* and nothing else at all. `nx run desktop:package` runs it as its
 * second command, so a package that cannot thumbnail fails the build that produced it. On its own:
 *
 *     pnpm exec playwright test -c apps/desktop-e2e/playwright.packaged.config.ts
 */
export default defineConfig({
  testDir: join(__dirname, 'src', 'packaged'),
  // One shell at a time, as next door: a launch holds an Instance's SQLite handle and the single-instance lock.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  // A packaged launch boots Nest and runs migrations, then thumbnails through libvips.
  timeout: 180_000,
});
