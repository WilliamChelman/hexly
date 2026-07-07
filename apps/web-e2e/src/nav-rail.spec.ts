import { enterLibrary, expect, openEntityActions, test } from './fixtures';

/**
 * The persistent nav rail and page-owned headers (ADR-0022, #89), driven as a
 * signed-in user. The rail is the only persistent chrome; each page renders its
 * own header. Responsive push-vs-overlay is exercised by setting the viewport.
 */
test('the rail navigates, exposes account controls, and pages own their headers', async ({
  page,
}) => {
  await enterLibrary(page);

  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();

  // Account + appearance live behind the avatar.
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await expect(
    page.getByRole('menuitem', { name: /Switch to (solar|astral) theme/ }),
  ).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Français' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New map' }).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('save-status')).toBeVisible();
  // Share now lives in the entity actions overflow menu.
  await openEntityActions(page);
  await expect(page.getByRole('menuitem', { name: 'Share' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Old All Maps / Design System buttons now moved to rail navigation.
  await expect(page.getByRole('link', { name: 'All maps' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Design system' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
});

test('on a wide viewport the expanded rail pushes the page and is remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterLibrary(page);

  const rail = page.getByTestId('nav-rail');
  const collapsed = (await rail.boundingBox())!.width;

  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
  // Poll past width transition: docked rail grows in place (pushes).
  await expect
    .poll(async () => (await rail.boundingBox())!.width)
    .toBeGreaterThan(collapsed);
  // No backdrop: pushes rather than overlays.
  await expect(page.getByTestId('rail-backdrop')).toHaveCount(0);

  // Expanded choice persists across reload (wide only).
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible();
});

test('on a narrow viewport the expanded rail overlays and dismisses on click-away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await enterLibrary(page);

  await page.getByRole('button', { name: 'Expand navigation' }).click();
  // Overlays with a backdrop to dismiss.
  await expect(page.getByTestId('rail-backdrop')).toBeVisible();

  // Choosing a destination collapses the overlay.
  await page
    .getByTestId('nav-rail-overlay')
    .getByRole('link', { name: 'Library' })
    .click();
  await expect(page.getByTestId('rail-backdrop')).toHaveCount(0);
});
