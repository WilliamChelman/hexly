import { expect, test, type Page } from './fixtures';

/**
 * Worlds vertical (#102, ADR-0024): create a World from the switcher → its Home
 * Entity appears and is navigable; switch Worlds → the entity browser filters to
 * the active World. The World switcher lives on the expanded nav rail.
 */

/** Expand the nav rail so the World switcher is on screen. */
async function expandRail(page: Page): Promise<void> {
  const toggle = page.getByTestId('rail-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(page.getByTestId('world-switcher')).toBeVisible();
}

/** Click "New world" and return the created WorldDetail (its id + homeEntityId). */
async function createWorld(
  page: Page,
): Promise<{ id: string; homeEntityId: string }> {
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/worlds') &&
      r.request().method() === 'POST' &&
      r.ok(),
  );
  await page.getByTestId('new-world').click();
  return (await created).json();
}

test('create a World → its Home Entity appears and is navigable', async ({
  page,
}) => {
  await page.goto('/entities');
  await expandRail(page);

  const world = await createWorld(page);

  // Creating switches to the new World and opens its Home note (named after it).
  await expect(page).toHaveURL(new RegExp(`/entities/${world.homeEntityId}$`));
  await expect(page.getByTestId('title')).toHaveText('Untitled world');

  // Back in the browser, the Home Entity is listed and openable.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByTestId(`open-${world.homeEntityId}`)).toBeVisible();
});

test('renaming the World renames its Home Entity, read-only on its page (ADR-0029)', async ({
  page,
}) => {
  await page.goto('/entities');
  await expandRail(page);

  const world = await createWorld(page);
  await expect(page).toHaveURL(new RegExp(`/entities/${world.homeEntityId}$`));
  await expect(page.getByTestId('title')).toHaveText('Untitled world');
  // The Home title is the World's name — never edited in place here.
  await expect(page.getByTestId('title')).not.toHaveAttribute('contenteditable');

  // Rename via the World (its name is the source of truth; no World rename UI yet).
  const renamed = await page.request.patch(`/api/worlds/${world.id}`, {
    data: { name: 'The Reach of Aldermoor' },
  });
  expect(renamed.ok()).toBeTruthy();

  // The Home Entity's title follows the World name on reload.
  await page.reload();
  await expect(page.getByTestId('title')).toHaveText('The Reach of Aldermoor');
});

test('switching Worlds filters the entity browser to the active World', async ({
  page,
}) => {
  await page.goto('/entities');
  await expandRail(page);

  // World A, with a distinctly-named note created inside it.
  const worldA = await createWorld(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId(`rename-${noteId}`).click();
  const input = page.getByTestId(`rename-input-${noteId}`);
  await input.fill('Alpha in A');
  await input.press('Enter');
  await expect(page.getByText('Alpha in A')).toBeVisible();

  // World B becomes active; A's note is out of scope, so it's gone from the list.
  const worldB = await createWorld(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByText('Alpha in A')).toHaveCount(0);
  expect(worldB.id).not.toBe(worldA.id);

  // Switch back to World A → its note returns.
  await page.getByTestId('world-switcher').selectOption(worldA.id);
  await expect(page.getByText('Alpha in A')).toBeVisible();
});
