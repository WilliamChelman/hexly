import { expect, launchAgain, test } from './desktop-app';

/** What a process on its way to hosting an Instance says — asserted live below, never assumed. */
const HOSTING = /Nest application|hosting/;

/**
 * Launching Hexly while it is already open shows you the Instance you have, rather than booting a second
 * one: two processes running boot migrations over one SQLite file is a race (ADR-0027, ADR-0070).
 */
test('a second launch shows the open window instead of booting a second server', async ({ launch, userDataDir }) => {
  const first = await launch();
  await first.window.waitForURL(/\/worlds$/);
  // The pattern the assertion below rests on, proved against a run that *did* host: a silent process only
  // means something if a hosting one is loud.
  expect(first.output()).toMatch(HOSTING);

  const minimized = () => first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized());
  // Minimized first, so "the window came back" is an observable state change. Deliberately not
  // `isFocused()`: which window holds focus is the window manager's answer, and a display-less session
  // cannot give an honest one.
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expect.poll(minimized).toBe(true);

  const second = await launchAgain(userDataDir);

  // It left of its own accord, cleanly, and before hosting anything.
  expect(second.exitCode).toBe(0);
  expect(second.output).not.toMatch(HOSTING);

  // What it did instead is hand the running app a `second-instance`, which restores the window.
  await expect.poll(minimized).toBe(false);
  expect(await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
