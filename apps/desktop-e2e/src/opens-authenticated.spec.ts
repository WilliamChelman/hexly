import { expect, test } from './desktop-app';

/**
 * Main mints the Sole User's session into the *renderer's* cookie jar before `loadURL` (ADR-0070), which no
 * browser run can exercise. The absences below are here for that reason, not as cut-list coverage (ADR-0071, #318).
 */
test('the window opens on the World Index with a session nobody typed', async ({ launch }) => {
  const { window } = await launch();

  // `/` is where main points the window; the client router lands it on the Index.
  await window.waitForURL(/\/worlds$/);
  await expect(window).toHaveTitle(/Worlds/);

  // Rendered, not just routed: an unauthenticated World list bounces to /session-error first. A first launch
  // seeds no starter World (ADR-0070).
  await expect(window.getByTestId('worlds-empty')).toBeVisible();
  await expect(window.getByTestId('create-world')).toBeVisible();

  await expect(window.getByLabel('Email')).toHaveCount(0);
  await expect(window.getByLabel('Password')).toHaveCount(0);

  // The menu is opened so the absence is a real one rather than an unrendered surface.
  await window.getByRole('button', { name: 'Open user menu' }).click();
  await expect(window.getByRole('menu')).toBeVisible();
  await expect(window.getByRole('menuitem', { name: /sign out/i })).toHaveCount(0);
});
