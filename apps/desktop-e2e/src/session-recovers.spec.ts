import { expect, test } from './desktop-app';

/**
 * A lapsed session recovers itself (ADR-0070, #321). Only a real shell can show this: the recovery runs
 * over the preload bridge, and the same 401 in a browser — which has no bridge — correctly ends on the
 * unrecoverable-session page instead, asserted at browser speed (#318, ADR-0071).
 *
 * `window` here is the app's Page, so the browser-side globals below are reached through `globalThis`.
 */
test('the preload bridge offers only what the renderer cannot do itself', async ({ launch }) => {
  const { window } = await launch();

  // The bridge is main's whole surface to the renderer, and it grows a member only when the renderer cannot
  // do the job itself: re-minting a session (#321), hearing the native menu's clicks (#322), and moving the
  // Asset bytes — a native picker, a filesystem and a `hexly.yml` write (#326). Its presence is still what the
  // client tests instead of reading a flag (ADR-0071).
  // Described rather than returned: a function does not survive the trip out of the page.
  const members = await window.evaluate(() =>
    Object.entries((globalThis as unknown as { hexly: Record<string, unknown> }).hexly).map(
      ([name, member]) => `${name}: ${typeof member}`,
    ),
  );
  expect(members).toEqual([
    'renewSession: function',
    'onMenuCommand: function',
    'moveAssetStorage: function',
    'cancelAssetStorageMove: function',
  ]);
});

test('a session deleted under the app is re-minted on the next navigation, where the user was', async ({ launch }) => {
  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);
  // Somewhere other than where main points the window, so "back where they were" is a claim worth making.
  await run.window.goto(`${run.origin}/settings`);
  await expect(run.window.getByTestId('theme-light')).toBeVisible();

  // The app's own logout endpoint is how a test deletes the session row from inside the shell — the
  // Instance Directory's SQLite file is held open by main, and one `node_modules` holds one ABI (ADR-0070),
  // so the runner cannot open it itself. Same end state as an expiry or a cleared jar: no row, no cookie.
  expect(await run.window.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).then((r) => r.status))).toBe(
    200,
  );
  // Really gone, checked with a bare `fetch` — which carries no interceptor, so nothing renews it here.
  expect(await run.window.evaluate(() => fetch('/api/auth/me').then((r) => r.status))).toBe(401);

  await run.window.reload();

  // The renewal ran before the guard's policy choice, so the navigation lands where it was going.
  await expect(run.window).toHaveURL(/\/settings$/);
  await expect(run.window.getByTestId('theme-light')).toBeVisible();
  // A bridge that answers never lets a navigation reach the unrecoverable error (#318).
  await expect(run.window.getByTestId('session-error')).toHaveCount(0);
  // And the session it re-minted is a real one, not a UI that merely stayed rendered.
  expect(await run.window.evaluate(() => fetch('/api/auth/me').then((r) => r.status))).toBe(200);
});
