import { expect, segRe, test } from './fixtures';

/**
 * The Shelf label (ADR-0080, #409): a World kept to be drawn from rather than played in.
 *
 * The unit tests own the grouping arithmetic and what a pick sends. What only a browser can answer is
 * here — that the label survives a reload, that the Index grows a second group only once there is a
 * Shelf, and that the Shelf is otherwise a World like any other.
 *
 * The e2e reset keeps Worlds, so the Shelf this spec mints is deleted at the end: left behind, it
 * would put a Shelves group on the Index for every spec that runs after.
 */
test('a World Owner labels a World a Shelf; it persists, the Index groups it apart, nothing is withheld', async ({
  page,
}) => {
  const created = await page.request.post('/api/worlds', { data: { name: 'The Art Shelf' } });
  expect(created.ok()).toBeTruthy();
  const shelf = await created.json();
  // A new World is a campaign unless said otherwise.
  expect(shelf.kind).toBe('campaign');

  try {
    // With no Shelf anywhere, the Index is exactly the one list it has always been.
    await page.goto('/');
    await expect(page.getByTestId('worlds-campaigns').getByTestId(`world-${shelf.id}`)).toBeVisible();
    await expect(page.getByTestId('worlds-shelves')).toHaveCount(0);

    // The Owner labels it, in World Settings.
    await page.goto(`/w/${shelf.id}/settings`);
    await page.getByTestId('settings-nav-kind').click();
    const saved = page.waitForResponse(
      (r) => /\/api\/worlds\/[\w-]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByTestId('world-kind-shelf').click();
    await saved;

    // It persists: the reload re-reads the label off the server, not off the click.
    await page.reload();
    await expect(page.getByTestId('world-kind-shelf')).toBeChecked();

    // Back to the Index through the app, not a reload: the Index holds a loaded list, so the regroup
    // has to reach it on the World's own nudge (ADR-0044) rather than on a fresh fetch.
    await page.getByRole('link', { name: 'Hexly home' }).click();
    await expect(page.getByTestId('worlds-shelves').getByTestId(`world-${shelf.id}`)).toBeVisible();
    await expect(page.getByTestId('worlds-campaigns').getByTestId(`world-${shelf.id}`)).toHaveCount(0);
    // The campaigns group keeps what it had — grouping drops nothing.
    await expect(
      page
        .getByTestId('worlds-campaigns')
        .getByTestId(/^world-/)
        .first(),
    ).toBeVisible();

    // Nothing is withheld from a Shelf: its card opens its Dashboard, and the Switcher offers it.
    await page.getByTestId(`world-${shelf.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/w/${segRe(shelf.id)}$`));
    await page.getByTestId('switcher').click();
    await expect(page.getByTestId(`switcher-option-${shelf.id}`)).toBeVisible();
  } finally {
    await page.request.delete(`/api/worlds/${shelf.id}`);
  }
});
