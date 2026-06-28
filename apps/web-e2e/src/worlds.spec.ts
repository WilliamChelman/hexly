import { expect, test, type Page } from './fixtures';

/**
 * URL-scoped Worlds + World Index (#118, ADR-0028): the root `/` is the World
 * Index — it lists reachable Worlds and owns create; the active World is a URL
 * fact (`/w/:worldId/entities`), so the entity browser is scoped by the segment
 * and switching Worlds re-scopes the list. The World switcher lives on the
 * expanded nav rail (relocating it is a later slice).
 */

/** Create a World from the Index and land on its Home Entity. Returns its id + homeEntityId. */
async function createWorldFromIndex(
  page: Page,
): Promise<{ id: string; homeEntityId: string }> {
  await page.goto('/');
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/worlds') &&
      r.request().method() === 'POST' &&
      r.ok(),
  );
  await page.getByTestId('create-world').click();
  const world = await (await created).json();
  await page.waitForURL(
    new RegExp(`/w/${world.id}/entities/${world.homeEntityId}$`),
  );
  return world;
}

/** Expand the nav rail so the World switcher is on screen. */
async function expandRail(page: Page): Promise<void> {
  const toggle = page.getByTestId('rail-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(page.getByTestId('world-switcher')).toBeVisible();
}

test('the World Index lists reachable Worlds; creating one opens its Home Entity', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your worlds' })).toBeVisible();

  const world = await createWorldFromIndex(page);
  // The Home note is named after the World (ADR-0029).
  await expect(page.getByTestId('title')).toHaveText('Untitled world');

  // Back on the Index, the new World is listed and tagged owned.
  await page.goto('/');
  await expect(page.getByTestId(`world-${world.id}`)).toBeVisible();
  await expect(page.getByTestId(`owned-${world.id}`)).toBeVisible();

  // Activating it enters its Entity browser (the URL carries the World).
  await page.getByTestId(`world-${world.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/w/${world.id}/entities$`));
});

test('renaming the World renames its Home Entity, read-only on its page (ADR-0029)', async ({
  page,
}) => {
  const world = await createWorldFromIndex(page);
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

test('the entity browser is scoped by the URL World; switching Worlds filters it', async ({
  page,
}) => {
  // World A, with a distinctly-named note created inside it.
  const worldA = await createWorldFromIndex(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldA.id}/entities$`));
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${worldA.id}/entities/[\\w-]+$`),
  );
  const noteId = page.url().split('/').pop();
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId(`rename-${noteId}`).click();
  const input = page.getByTestId(`rename-input-${noteId}`);
  await input.fill('Alpha in A');
  await input.press('Enter');
  await expect(page.getByText('Alpha in A')).toBeVisible();

  // World B is a different scope: A's note is out of scope, so it's gone from the list.
  const worldB = await createWorldFromIndex(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldB.id}/entities$`));
  await expect(page.getByText('Alpha in A')).toHaveCount(0);
  expect(worldB.id).not.toBe(worldA.id);

  // Switch back to World A via the switcher (it navigates by URL) → its note returns.
  await expandRail(page);
  await page.getByTestId('world-switcher').selectOption(worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${worldA.id}/entities$`));
  await expect(page.getByText('Alpha in A')).toBeVisible();
});
