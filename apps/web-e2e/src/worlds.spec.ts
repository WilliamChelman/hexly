import { authToken, expect, test, type Page } from './fixtures';

/**
 * URL-scoped Worlds + World Index (#118, ADR-0028): the root `/` is the World
 * Index — it lists reachable Worlds and owns create; the active World is a URL
 * fact (`/w/:worldId/entities`), so the entity browser is scoped by the segment
 * and switching Worlds re-scopes the list. The World switcher is a compact
 * dropdown docked by the user menu in the nav-rail foot, at both widths (#121).
 */

/**
 * Create a World from the Index and land on its Home Entity. Both ids are read off
 * the landing URL (`/w/:worldId/entities/:homeEntityId`) — the TrailBase create
 * returns only an id, and the client composes the rest (#129), so the URL is the
 * authoritative source for the test rather than the network response.
 */
async function createWorldFromIndex(
  page: Page,
): Promise<{ id: string; homeEntityId: string }> {
  await page.goto('/');
  await page.getByTestId('create-world').click();
  await page.waitForURL(/\/w\/[^/]+\/entities\/[^/]+$/);
  const [, id, homeEntityId] = page.url().match(/\/w\/([^/]+)\/entities\/([^/]+)$/)!;
  // The raw id (decoded) matches data-testids and is what the API expects; the URL
  // form is re-derived with seg() since TrailBase UUIDs base64-encode to a `=` the
  // browser percent-encodes in the path.
  return { id: decodeURIComponent(id), homeEntityId: decodeURIComponent(homeEntityId) };
}

/** A World/Entity id as it appears in a URL path segment (percent-encoded). */
function seg(id: string): string {
  return encodeURIComponent(id);
}

/** Open the masthead World switcher and hop to another World by id. */
async function switchToWorld(page: Page, worldId: string): Promise<void> {
  await page.getByTestId('switcher').click();
  await page.getByTestId(`switcher-option-${worldId}`).click();
}

/**
 * Rename a World through its TrailBase Record API (ADR-0032). There is no World
 * rename UI yet — the World name is the source of truth for its Home note's title
 * (ADR-0029) — so the test drives the API directly with the app's own token.
 */
async function renameWorld(page: Page, id: string, name: string): Promise<void> {
  const res = await page.request.patch(
    `/api/records/v1/worlds/${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${await authToken(page)}` }, data: { name } },
  );
  expect(res.ok()).toBeTruthy();
}

test('the World Index lists reachable Worlds; creating one opens its Home Entity', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

  const world = await createWorldFromIndex(page);
  // The Home note is named after the World (ADR-0029).
  await expect(page.getByTestId('title')).toHaveText('Untitled world');

  // Back on the Index, the new World is listed and tagged owned.
  await page.goto('/');
  await expect(page.getByTestId(`world-${world.id}`)).toBeVisible();
  await expect(page.getByTestId(`owned-${world.id}`)).toBeVisible();

  // Activating it enters its Entity browser (the URL carries the World).
  await page.getByTestId(`world-${world.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/w/${seg(world.id)}/entities$`));
});

test('renaming the World renames its Home Entity, read-only on its page (ADR-0029)', async ({
  page,
}) => {
  const world = await createWorldFromIndex(page);
  await expect(page.getByTestId('title')).toHaveText('Untitled world');
  // The Home title is the World's name — never edited in place here.
  await expect(page.getByTestId('title')).not.toHaveAttribute('contenteditable');

  // Rename via the World (its name is the source of truth; no World rename UI yet).
  await renameWorld(page, world.id, 'The Reach of Aldermoor');

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
  await page.getByTestId(`delete-world-${world.id}`).click();
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

  await page.goto(`/w/${seg(worldB.id)}/entities/${seg(worldA.homeEntityId)}`);

  // The reconcile guard lands on the Entity under its correct World segment.
  await expect(page).toHaveURL(
    new RegExp(`/w/${seg(worldA.id)}/entities/${seg(worldA.homeEntityId)}$`),
  );
});

test('the entity browser is scoped by the URL World; switching Worlds filters it', async ({
  page,
}) => {
  // World A, with a distinctly-named note created inside it.
  const worldA = await createWorldFromIndex(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${seg(worldA.id)}/entities$`));
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${seg(worldA.id)}/entities/[^/]+$`),
  );
  const noteId = decodeURIComponent(page.url().split('/').pop()!);
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId(`rename-${noteId}`).click();
  const input = page.getByTestId(`rename-input-${noteId}`);
  await input.fill('Alpha in A');
  await input.press('Enter');
  await expect(page.getByText('Alpha in A')).toBeVisible();

  // World B is a different scope: A's note is out of scope, so it's gone from the list.
  const worldB = await createWorldFromIndex(page);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${seg(worldB.id)}/entities$`));
  await expect(page.getByText('Alpha in A')).toHaveCount(0);
  expect(worldB.id).not.toBe(worldA.id);

  // Switch back to World A via the switcher (it navigates by URL) → its note returns.
  await switchToWorld(page, worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${seg(worldA.id)}/entities$`));
  await expect(page.getByText('Alpha in A')).toBeVisible();
});

test('the masthead switcher shows the current World and hops to another (#121)', async ({
  page,
}) => {
  // Two distinctly-named Worlds so the switcher's current-World label is legible.
  const worldA = await createWorldFromIndex(page);
  await renameWorld(page, worldA.id, 'Aldermoor');
  const worldB = await createWorldFromIndex(page);
  await renameWorld(page, worldB.id, 'Whisperwood');

  // Land in World B; the switcher (loaded fresh) names B as the current World.
  await page.goto(`/w/${worldB.id}/entities`);
  await expect(page.getByTestId('switcher')).toContainText('Whisperwood');

  // Hopping to World A re-scopes the URL to A's entity browser.
  await switchToWorld(page, worldA.id);
  await expect(page).toHaveURL(new RegExp(`/w/${seg(worldA.id)}/entities$`));
  await expect(page.getByTestId('switcher')).toContainText('Aldermoor');
});
