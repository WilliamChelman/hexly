import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './desktop-app';

/**
 * Stand in for the platform's browser and record what it was asked to open. Patched on the very `electron`
 * module main calls through — without it, every run of this spec would open the developer's real browser.
 */
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

/** The URLs main has handed to the system browser so far. */
function handedOff(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { handedOff: string[] }).handedOff);
}

/**
 * What each window is showing, as main sees it. Asked of main rather than of the page because a navigation the
 * shell cancels leaves Playwright's own page bookkeeping waiting for a commit that never comes — and main's
 * view is the one that decides what the user is looking at anyway.
 */
function showing(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));
}

/** Put a link on the page as authored Content would render one. */
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
 * Click it. `dispatchEvent` rather than `page.click`: a click that is handed off schedules a navigation the
 * shell then cancels, and `page.click` waits for that navigation to finish — which, this feature working, it
 * never does. The anchor follows its `href` on a synthetic click all the same.
 */
function clickLink(window: Page): Promise<void> {
  return window.locator('#external-link').dispatchEvent('click');
}

/**
 * A link inside Content is the user's own, pointing at a source or a wiki, and this window is not a browser
 * tab: followed in place it would navigate the SPA away with no back button, stranding the user (ADR-0070).
 * Both paths need intercepting and they are genuinely different — `setWindowOpenHandler` for a
 * `target="_blank"`, `will-navigate` for a plain click — so both are exercised here, in that order, because
 * the second one leaves Playwright waiting on a navigation the shell cancelled.
 *
 * A shell is the only place this fact exists: in a browser the same click is the browser's own business.
 */
test('an external link is handed to the system browser, and the window stays where it was', async ({ launch }) => {
  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);
  // Rendered, not merely routed, so the clicks below land on a page that has finished moving.
  await expect(run.window.getByTestId('worlds-empty')).toBeVisible();
  await interceptSystemBrowser(run.app);

  // The link asks for a window of its own — which is a browser window, not one of ours.
  await injectLink(run.window, 'https://example.com/bestiary', '_blank');
  await clickLink(run.window);

  await expect.poll(() => handedOff(run.app)).toEqual(['https://example.com/bestiary']);
  // The whole point: one window, still on the World Index, with nothing opened over it.
  await expect.poll(() => showing(run.app)).toEqual([expect.stringMatching(/\/worlds$/)]);
  await expect(run.window.getByTestId('worlds-empty')).toBeVisible();

  // The same handler leaves our own origin alone: a `window.open` from inside the SPA — the Palette's and the
  // World Graph's modifier-click — opens a second Hexly window rather than going to the browser.
  const opening = run.app.waitForEvent('window');
  await run.window.evaluate(() => void window.open('/worlds', '_blank'));
  const internal = await opening;
  await internal.waitForURL(/\/worlds$/);
  expect(new URL(internal.url()).origin).toBe(run.origin);
  expect(await handedOff(run.app)).toHaveLength(1);
  await internal.close();

  // And the in-place path: a plain click, which without the guard would replace the SPA with the page.
  await injectLink(run.window, 'https://example.com/hex-crawl', '');
  await clickLink(run.window);

  await expect
    .poll(() => handedOff(run.app))
    .toEqual(['https://example.com/bestiary', 'https://example.com/hex-crawl']);
  await expect.poll(() => showing(run.app)).toEqual([expect.stringMatching(/\/worlds$/)]);
});
