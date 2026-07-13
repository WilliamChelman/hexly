import { entityIdFromUrl, expect, segRe, test, type Page } from './fixtures';

/**
 * URL-scoped Worlds + World Index (ADR-0028): the root `/` is the World Index; the
 * active World is a URL fact (`/w/:worldId/entities`), so the entity browser is scoped
 * by the segment and switching Worlds re-scopes the list.
 */

/** Create a World from the Index and land on its Dashboard (the World root). Returns its id. */
async function createWorldFromIndex(page: Page): Promise<{ id: string }> {
  await page.goto('/');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/worlds') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('create-world').click();
  const world = await (await created).json();
  // Creating a World lands on its root (the Dashboard, ADR-0043), not a seeded note.
  await page.waitForURL(new RegExp(`/w/${segRe(world.id)}(/|$)`));
  return world;
}

/** Create a fresh note in a World's Library and return its entity id. */
async function createNote(page: Page, worldId: string): Promise<string> {
  await page.goto(`/w/${worldId}/entities`);
  await page.getByTestId('new-note').click();
  await page.waitForURL(new RegExp(`/w/${segRe(worldId)}/entities/[\\w-]+$`));
  return entityIdFromUrl(page);
}

/** Open the masthead World switcher and hop to another World by id. */
async function switchToWorld(page: Page, worldId: string): Promise<void> {
  await page.getByTestId('switcher').click();
  await page.getByTestId(`switcher-option-${worldId}`).click();
}

test('the World Index lists reachable Worlds; creating one lands on its root', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

  const world = await createWorldFromIndex(page);
  // A fresh World seeds no Entities (ADR-0043) — creation lands on the World root.
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(world.id)}(/|$)`));

  await page.goto('/');
  await expect(page.getByTestId(`world-${world.id}`)).toBeVisible();
  await expect(page.getByTestId(`owned-${world.id}`)).toBeVisible();

  // Activating the card lands on the World Dashboard — the World root (ADR-0043).
  await page.getByTestId(`world-${world.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(world.id)}$`));
  await expect(page.getByTestId('dashboard-empty')).toBeVisible();
});

test('type-to-confirm delete shows the entity count, enables on match, and removes the World (#120)', async ({
  page,
}) => {
  const world = await createWorldFromIndex(page);
  await page.goto('/');
  await expect(page.getByTestId(`world-${world.id}`)).toBeVisible();

  const counted = page.waitForResponse((r) => r.url().endsWith(`/api/worlds/${world.id}`) && r.ok());
  await page.getByTestId(`delete-world-${world.id}`).click();
  await counted;
  // A fresh World holds no Entities (ADR-0043).
  await expect(page.getByTestId('delete-count')).toContainText('0');

  // Delete is locked until the World's name is typed exactly.
  const confirm = page.getByTestId('confirm-delete');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('delete-confirm-input').fill('Untitled world');
  await expect(confirm).toBeEnabled();

  await confirm.click();
  await expect(page.getByTestId(`world-${world.id}`)).toHaveCount(0);
});

test('a stale World segment reconciles to the Entity’s real World (ADR-0028, #119)', async ({ page }) => {
  const worldA = await createWorldFromIndex(page);
  const noteA = await createNote(page, worldA.id);
  const worldB = await createWorldFromIndex(page);
  expect(worldB.id).not.toBe(worldA.id);

  // Open A’s note under B’s (wrong) segment.
  await page.goto(`/w/${worldB.id}/entities/${noteA}`);

  // Reconcile guard lands on the Entity under its correct World segment.
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldA.id)}/entities/${segRe(noteA)}$`));
});

test('the entity browser is scoped by the URL World; switching Worlds filters it', async ({ page }) => {
  const worldA = await createWorldFromIndex(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldA.id)}/entities$`));
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldA.id)}/entities/[\\w-]+$`));
  const noteId = entityIdFromUrl(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId(`rename-${noteId}`).click();
  const input = page.getByTestId(`rename-input-${noteId}`);
  await input.fill('Alpha in A');
  await input.press('Enter');
  await expect(page.getByText('Alpha in A')).toBeVisible();

  // World B is a different scope; A's note is out of scope.
  const worldB = await createWorldFromIndex(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldB.id)}/entities$`));
  await expect(page.getByText('Alpha in A')).toHaveCount(0);
  expect(worldB.id).not.toBe(worldA.id);

  // Switch back to World A via the switcher — it lands on A's Dashboard (ADR-0043).
  await switchToWorld(page, worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldA.id)}$`));
  // Back in A's Library, its note returns.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldA.id)}/entities$`));
  await expect(page.getByText('Alpha in A')).toBeVisible();
});

test('the masthead switcher shows the current World and hops to another (#121)', async ({ page }) => {
  const worldA = await createWorldFromIndex(page);
  await page.request.patch(`/api/worlds/${worldA.id}`, {
    data: { name: 'Aldermoor' },
  });
  const worldB = await createWorldFromIndex(page);
  await page.request.patch(`/api/worlds/${worldB.id}`, {
    data: { name: 'Whisperwood' },
  });

  // Land in World B; switcher names B as the current World.
  await page.goto(`/w/${worldB.id}/entities`);
  await expect(page.getByTestId('switcher')).toContainText('Whisperwood');

  // Hopping to World A re-scopes the URL — landing on A's Dashboard (ADR-0043).
  await switchToWorld(page, worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(worldA.id)}$`));
  await expect(page.getByTestId('switcher')).toContainText('Aldermoor');
});
