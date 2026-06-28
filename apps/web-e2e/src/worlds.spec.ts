import { expect, test, type Page } from './fixtures';

/**
 * URL-scoped Worlds + World Index (#118, ADR-0028): the root `/` is the World
 * Index — it lists reachable Worlds and owns create; the active World is a URL
 * fact (`/w/:worldId/entities`), so the entity browser is scoped by the segment
 * and switching Worlds re-scopes the list. The World switcher is a compact
 * dropdown docked by the user menu in the nav-rail foot, at both widths (#121).
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

/** Open the foot-of-rail World switcher and hop to another World by id. */
async function switchToWorld(page: Page, worldId: string): Promise<void> {
  await page.getByTestId('world-switcher').click();
  await page.getByTestId(`world-option-${worldId}`).click();
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

test('type-to-confirm delete shows the entity count, enables on match, and removes the World (#120)', async ({
  page,
}) => {
  const world = await createWorldFromIndex(page);
  await page.goto('/');
  await expect(page.getByTestId(`world-${world.id}`)).toBeVisible();

  // Opening the modal reads the World's entity count (a fresh World has its Home).
  const counted = page.waitForResponse(
    (r) => r.url().endsWith(`/api/worlds/${world.id}`) && r.ok(),
  );
  await page.getByTestId(`delete-world-${world.id}`).click();
  await counted;
  await expect(page.getByTestId('delete-count')).toContainText('1');

  // Delete is locked until the World's name is typed exactly.
  const confirm = page.getByTestId('confirm-delete');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('delete-confirm-input').fill('Untitled world');
  await expect(confirm).toBeEnabled();

  // Confirming removes the World from the Index.
  await confirm.click();
  await expect(page.getByTestId(`world-${world.id}`)).toHaveCount(0);
});

test('a stale World segment reconciles to the Entity’s real World (ADR-0028, #119)', async ({
  page,
}) => {
  // Two Worlds; open World A's Home Entity under World B's (wrong) segment.
  const worldA = await createWorldFromIndex(page);
  const worldB = await createWorldFromIndex(page);
  expect(worldB.id).not.toBe(worldA.id);

  await page.goto(`/w/${worldB.id}/entities/${worldA.homeEntityId}`);

  // The reconcile guard lands on the Entity under its correct World segment.
  await expect(page).toHaveURL(
    new RegExp(`/w/${worldA.id}/entities/${worldA.homeEntityId}$`),
  );
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
  await switchToWorld(page, worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${worldA.id}/entities$`));
  await expect(page.getByText('Alpha in A')).toBeVisible();
});

test('the foot-of-rail switcher shows the current World and hops to another (#121)', async ({
  page,
}) => {
  // Two distinctly-named Worlds so the switcher's current-World label is legible.
  const worldA = await createWorldFromIndex(page);
  await page.request.patch(`/api/worlds/${worldA.id}`, {
    data: { name: 'Aldermoor' },
  });
  const worldB = await createWorldFromIndex(page);
  await page.request.patch(`/api/worlds/${worldB.id}`, {
    data: { name: 'Whisperwood' },
  });

  // Land in World B; the switcher (loaded fresh) names B as the current World.
  await page.goto(`/w/${worldB.id}/entities`);
  await expect(page.getByTestId('world-switcher')).toContainText('Whisperwood');

  // Hopping to World A re-scopes the URL to A's entity browser.
  await switchToWorld(page, worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${worldA.id}/entities$`));
  await expect(page.getByTestId('world-switcher')).toContainText('Aldermoor');
});
