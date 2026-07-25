import { expect, test } from './desktop-app';

/** Distinctive on purpose: no fresh Instance could produce this name, so its presence is the edit's. */
const RENAMED = 'Survived the relaunch';

/**
 * An edit made in one run is there in the next. Three things have to hold for that at once: the Instance
 * Directory is pinned to the same folder both times (ADR-0070), the ordered quit lets the shutdown hooks
 * close the SQLite handle (ADR-0027), and the Sole User is *reused* rather than re-seeded — a second user
 * row would leave the World with no grant to it, so the Index would come back empty.
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

  // The edit itself: renaming is offered on the Index, which creating a World navigated away from.
  await first.window.goto(`${first.origin}/worlds`);
  const renamed = first.window.waitForResponse(
    (res) => res.url().endsWith(`/api/worlds/${world.id}`) && res.request().method() === 'PATCH' && res.ok(),
  );
  await first.window.getByTestId(`rename-world-${world.id}`).click();
  const input = first.window.getByTestId(`rename-world-input-${world.id}`);
  await input.fill(RENAMED);
  await input.press('Enter');
  await renamed;
  // The card carries the World's name as its accessible name.
  await expect(first.window.getByTestId(`world-${world.id}`)).toHaveAttribute('aria-label', RENAMED);

  await first.close();

  const second = await launch();
  await second.window.waitForURL(/\/worlds$/);
  await expect(second.window.getByTestId(`world-${world.id}`)).toHaveAttribute('aria-label', RENAMED);
});
