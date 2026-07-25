import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './desktop-app';

/** Stands in for the platform's browser: without it, every run of this spec opens the developer's real one. */
async function interceptSystemBrowser(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const handedOff: string[] = [];
    (globalThis as unknown as { handedOff: string[] }).handedOff = handedOff;
    shell.openExternal = (url: string) => {
      handedOff.push(url);
      return Promise.resolve();
    };
  });
}

function handedOff(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { handedOff: string[] }).handedOff);
}

/**
 * Asked of main rather than of the page: a navigation the shell cancels leaves Playwright's own page bookkeeping
 * waiting for a commit that never comes.
 */
function showing(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
}

function injectLink(window: Page, href: string, target: string): Promise<void> {
  return window.evaluate(
    ([url, blank]) => {
      const link = (document.getElementById('external-link') as HTMLAnchorElement) ?? document.createElement('a');
      link.id = 'external-link';
      link.href = url;
      link.target = blank;
      link.textContent = 'a source';
      document.body.append(link);
    },
    [href, target],
  );
}

/**
 * `dispatchEvent` rather than `page.click`: a handed-off click schedules a navigation the shell then cancels, and
 * `page.click` would wait for it to finish.
 */
function clickLink(window: Page): Promise<void> {
  return window.locator('#external-link').dispatchEvent('click');
}

/**
 * Followed in place, a link inside Content would navigate the SPA away with no back button (ADR-0070). Both
 * paths are exercised in this order — `setWindowOpenHandler` for `target="_blank"`, then `will-navigate`, whose
 * cancelled navigation leaves Playwright waiting.
 */
test('an external link is handed to the system browser, and the window stays where it was', async ({ launch }) => {
  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);
  // Rendered, not merely routed, so the clicks below land on a page that has finished moving.
  await expect(run.window.getByTestId('worlds-empty')).toBeVisible();
  await interceptSystemBrowser(run.app);

  await injectLink(run.window, 'https://example.com/bestiary', '_blank');
  await clickLink(run.window);

  await expect.poll(() => handedOff(run.app)).toEqual(['https://example.com/bestiary']);
  await expect.poll(() => showing(run.app)).toEqual([expect.stringMatching(/\/worlds$/)]);
  await expect(run.window.getByTestId('worlds-empty')).toBeVisible();

  // The same handler leaves our own origin alone: a `window.open` from inside the SPA — the Palette's and the
  // World Graph's modifier-click — opens a second Hexly window.
  const opening = run.app.waitForEvent('window');
  await run.window.evaluate(() => void window.open('/worlds', '_blank'));
  const internal = await opening;
  await internal.waitForURL(/\/worlds$/);
  expect(new URL(internal.url()).origin).toBe(run.origin);
  expect(await handedOff(run.app)).toHaveLength(1);
  await internal.close();

  // The in-place path: without the guard, a plain click replaces the SPA with the page.
  await injectLink(run.window, 'https://example.com/hex-crawl', '');
  await clickLink(run.window);

  await expect
    .poll(() => handedOff(run.app))
    .toEqual(['https://example.com/bestiary', 'https://example.com/hex-crawl']);
  await expect.poll(() => showing(run.app)).toEqual([expect.stringMatching(/\/worlds$/)]);
});
