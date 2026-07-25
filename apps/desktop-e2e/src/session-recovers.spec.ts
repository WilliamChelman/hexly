import { expect, test } from './desktop-app';

/**
 * A lapsed session recovers itself over the preload bridge (ADR-0070, #321); the same 401 in a browser, which has
 * no bridge, ends on the unrecoverable-session page instead (#318, ADR-0071).
 *
 * `window` here is the app's Page, so the browser-side globals below are reached through `globalThis`.
 */
test('the preload bridge offers only what the renderer cannot do itself', async ({ launch }) => {
  const { window } = await launch();

  // The bridge grows a member only when the renderer cannot do the job itself (#321, #322, #326), and its
  // presence is what the client tests instead of reading a flag (ADR-0071).
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

  // Logout from inside the shell, because main holds the SQLite file open and one `node_modules` holds one ABI
  // (ADR-0070); same end state as an expiry.
  expect(await run.window.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).then((r) => r.status))).toBe(
    200,
  );
  // A bare `fetch` carries no interceptor, so nothing renews the session here.
  expect(await run.window.evaluate(() => fetch('/api/auth/me').then((r) => r.status))).toBe(401);

  await run.window.reload();

  // The renewal ran before the guard's policy choice, so the navigation lands where it was going.
  await expect(run.window).toHaveURL(/\/settings$/);
  await expect(run.window.getByTestId('theme-light')).toBeVisible();
  await expect(run.window.getByTestId('session-error')).toHaveCount(0);
  // A real session, not a UI that merely stayed rendered.
  expect(await run.window.evaluate(() => fetch('/api/auth/me').then((r) => r.status))).toBe(200);
});
