import { expect, launchAgain, test } from './desktop-app';

/** What a process on its way to hosting an Instance says. */
const HOSTING = /Nest application|hosting/;

/** Two processes running boot migrations over one SQLite file is a race (ADR-0027, ADR-0070). */
test('a second launch shows the open window instead of booting a second server', async ({ launch, userDataDir }) => {
  const first = await launch();
  await first.window.waitForURL(/\/worlds$/);
  // Proved against a run that *did* host: a silent process only means something if a hosting one is loud.
  expect(first.output()).toMatch(HOSTING);

  const minimized = () => first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized());
  // Minimized first, so the restore is an observable state change; not `isFocused()`, which a display-less
  // session cannot answer honestly.
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect.poll(minimized).toBe(true);

  const second = await launchAgain(userDataDir);

  expect(second.exitCode).toBe(0);
  expect(second.output).not.toMatch(HOSTING);

  // The running app got a `second-instance`, which restores the window.
  await expect.poll(minimized).toBe(false);
  expect(await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
