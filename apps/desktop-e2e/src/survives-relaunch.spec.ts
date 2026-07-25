import { expect, test } from './desktop-app';

/** Distinctive on purpose: no fresh Instance could produce this name. */
const RENAMED = 'Survived the relaunch';

/**
 * Three things have to hold at once: the Instance Directory is pinned to the same folder both times (ADR-0070),
 * the ordered quit closes the SQLite handle (ADR-0027), and the Sole User is *reused* rather than re-seeded — a
 * second user row would leave the World with no grant to it.
 */
test('an edit made in one run is there after a relaunch', async ({ launch }) => {
  const first = await launch();
  await first.window.waitForURL(/\/worlds$/);

  const created = first.window.waitForResponse(
    (res) => res.url().endsWith('/api/worlds') && res.request().method() === 'POST' && res.ok(),
  );
  await first.window.getByTestId('create-world').click();
  const world = await (await created).json();
  await first.window.waitForURL(/\/w\/[^/]+/);

  // Renaming is offered on the Index, which creating a World navigated away from.
  await first.window.goto(`${first.origin}/worlds`);
  const renamed = first.window.waitForResponse(
    (res) => res.url().endsWith(`/api/worlds/${world.id}`) && res.request().method() === 'PATCH' && res.ok(),
  );
  await first.window.getByTestId(`rename-world-${world.id}`).click();
  const input = first.window.getByTestId(`rename-world-input-${world.id}`);
  await input.fill(RENAMED);
  await input.press('Enter');
  await renamed;
  await expect(first.window.getByTestId(`world-${world.id}`)).toHaveAttribute('aria-label', RENAMED);

  await first.close();

  const second = await launch();
  await second.window.waitForURL(/\/worlds$/);
  await expect(second.window.getByTestId(`world-${world.id}`)).toHaveAttribute('aria-label', RENAMED);
});

/** Read as the shell sees it, since geometry is main's business and the renderer has no view of it (ADR-0070). */
test('the window reopens at the size and position it was left', async ({ launch }) => {
  const first = await launch();
  await first.window.waitForURL(/\/worlds$/);

  // Nothing near the default 1440×900, so no fresh launch could produce this by accident; read back because a
  // window manager may adjust what it was asked for.
  const left = await first.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setBounds({ x: 140, y: 90, width: 1024, height: 720 });
    return window.getBounds();
  });
  expect(left).toMatchObject({ width: 1024, height: 720 });

  // This path reaches `app.exit`, which emits no window `close`, so only the flush saves the bounds.
  await first.close();

  const second = await launch();
  const reopened = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

  expect(reopened).toEqual(left);
});
