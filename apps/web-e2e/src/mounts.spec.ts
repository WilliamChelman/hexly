import { addWorldMember, expect, installMonsterPack, segRe, signInGrantee, test, type Page } from './fixtures';

/**
 * A World declares the Containers it draws from, and draws on them (#408, #410, ADR-0080), end to end.
 * The rules — Own-only, the Compendium exception, idempotence, the refusals, the whole shape of the
 * read cascade — are pinned at the HTTP seam in `world-mounts.controller.spec.ts` and
 * `mount-cascade.controller.spec.ts`. What only a browser shows is the surface itself: that a World
 * Owner can find the pane, see what is mounted in the order they set, add from an offer, reorder, and
 * withdraw one; and that a player of the campaign then really lands on a shelf Entity's page.
 */

/**
 * The Worlds this file minted, dropped again afterwards. The reset between specs clears Entities but
 * not Worlds (ADR-0009), so a spec that leaves three behind lengthens every other spec's World
 * Switcher and Index — cleaning up is this file's own business, not theirs.
 */
const minted: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of minted.splice(0)) await page.request.delete(`/api/worlds/${id}`);
});

/** Create a World from the Index and return its id. */
async function createWorld(page: Page, name: string): Promise<string> {
  await page.goto('/');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/worlds') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('create-world').click();
  await page.getByTestId('create-world-name').fill(name);
  await page.getByTestId('confirm-create-world').click();
  const world = await (await created).json();
  await page.waitForURL(new RegExp(`/w/${segRe(world.id)}(/|$)`));
  minted.push(world.id as string);
  return world.id as string;
}

/** A tiptap doc whose one paragraph carries a prose Entity Link to `entityId` — a semantic edge. */
function proseLinking(entityId: string, label: string) {
  return {
    format: 'tiptap-v3',
    snapshot: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId, label } }] }],
    },
  };
}

/** Mint a Note in `worldId`, optionally with a document — the fixture behind a countable link. */
async function createEntity(page: Page, worldId: string, name: string, document?: unknown): Promise<string> {
  const created = await page.request.post('/api/entities', {
    data: { name, types: ['core.type.note'], worldId, ...(document ? { document } : {}) },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  return (await created.json()).id as string;
}

/** Mount `containerId` through the pane's add control, picked by id so a duplicate name cannot fool it. */
async function mount(page: Page, containerId: string): Promise<void> {
  await page.getByTestId('mount-add-select').selectOption(containerId);
  await page.getByTestId('mount-add').click();
  await expect(page.getByTestId(`mount-${containerId}`)).toBeVisible();
}

/** The mounted Containers in the order the pane shows them. */
function mountedOrder(page: Page) {
  return page.locator('li[data-testid^="mount-"]');
}

test('a World Owner declares what this World draws from, orders it, and withdraws one', async ({ page, browser }) => {
  // A pack is Instance-wide and stocked by the operator (#404); mounting one is the World Owner's.
  await installMonsterPack(browser);
  const pack = (await (await page.request.get('/api/compendiums')).json())[0].id as string;

  const shelf = await createWorld(page, 'The Art Shelf');
  const campaign = await createWorld(page, 'The Mounting Campaign');

  await page.goto(`/w/${campaign}/settings`);
  await page.getByTestId('settings-nav-mounts').click();
  // Nothing is mounted automatically — not on install, not at World creation (ADR-0080).
  await expect(page.getByTestId('mount-add-select').locator(`option[value="${pack}"]`)).toHaveCount(1);
  await expect(page.getByText('This world draws on nothing yet.')).toBeVisible();

  await mount(page, shelf);
  await mount(page, pack);

  // Each Mount names its Container and which kind it is.
  await expect(page.getByTestId(`mount-${shelf}`)).toContainText('The Art Shelf');
  await expect(page.getByTestId(`mount-kind-${shelf}`)).toContainText('World');
  await expect(page.getByTestId(`mount-${pack}`)).toContainText('Draw Steel: Monsters');
  await expect(page.getByTestId(`mount-kind-${pack}`)).toContainText('Compendium');
  // What is mounted is no longer on offer, so nothing invites a second declaration of the same thing.
  await expect(page.getByTestId('mount-add-select').locator(`option[value="${shelf}"]`)).toHaveCount(0);

  // The Owner's own order, set by moving one past the other.
  await expect(mountedOrder(page)).toHaveCount(2);
  await page.getByTestId(`mount-up-${pack}`).click();
  await expect(mountedOrder(page).first()).toHaveAttribute('data-testid', `mount-${pack}`);

  // It is stored, not staged: a reload lands on the same pane, in the same order.
  await page.reload();
  await expect(mountedOrder(page).first()).toHaveAttribute('data-testid', `mount-${pack}`);
  await expect(mountedOrder(page).last()).toHaveAttribute('data-testid', `mount-${shelf}`);

  // Unmounting withdraws that declaration and nothing else — the World it named is untouched. It
  // states its blast radius first (#414): nothing points into this shelf, said in words.
  await page.getByTestId(`mount-remove-${shelf}`).click();
  await expect(page.getByTestId('unmount-count')).toContainText('Nothing in this world points into it');
  await page.getByTestId('confirm-unmount').click();
  await expect(page.getByTestId(`mount-${shelf}`)).toHaveCount(0);
  await expect(page.getByTestId(`mount-${pack}`)).toBeVisible();
  await page.goto(`/w/${shelf}`);
  await expect(page.getByTestId('dashboard-empty')).toBeVisible();
});

test('unmounting states how many links it would break, and unmounts anyway', async ({ page }) => {
  const shelf = await createWorld(page, 'The Counted Shelf');
  const campaign = await createWorld(page, 'The Counting Campaign');

  // One link from the campaign into the shelf: the blast radius of dropping this Mount.
  const sunset = await createEntity(page, shelf, 'Sunset over Aldermoor');
  await createEntity(page, campaign, 'The Tavern', {
    'core.field.content': proseLinking(sunset, 'Sunset over Aldermoor'),
  });

  await page.goto(`/w/${campaign}/settings`);
  await page.getByTestId('settings-nav-mounts').click();
  await mount(page, shelf);

  await page.getByTestId(`mount-remove-${shelf}`).click();
  // A number and a confirm (ADR-0080): stated before the act, worded for who keeps the links working.
  await expect(page.getByTestId('unmount-count')).toContainText('1 link in this world points into it');
  await expect(page.getByTestId('unmount-count')).toContainText('keep working for you');

  // Backing out changes nothing…
  await page.getByTestId('cancel-unmount').click();
  await expect(page.getByTestId(`mount-${shelf}`)).toBeVisible();

  // …and going through is never refused, whatever the number said.
  await page.getByTestId(`mount-remove-${shelf}`).click();
  await page.getByTestId('confirm-unmount').click();
  await expect(page.getByTestId(`mount-${shelf}`)).toHaveCount(0);
});

test('mounting changes nothing about what the World holds', async ({ page, browser }) => {
  await installMonsterPack(browser);
  const pack = (await (await page.request.get('/api/compendiums')).json())[0].id as string;
  const campaign = await createWorld(page, 'The Unchanged Campaign');

  await page.goto(`/w/${campaign}/settings`);
  await page.getByTestId('settings-nav-mounts').click();
  await mount(page, pack);

  // A Mount widens what a World may *point at*, never what it *holds* (ADR-0080): two thousand
  // entries' worth of shelf, and the Entity Browser still says this World is empty.
  await page.goto(`/w/${campaign}/entities`);
  await expect(page.getByTestId('empty')).toBeVisible();
});

test('a player of the campaign lands on the shelf Entity’s own page, and an anonymous reader on the pack’s', async ({
  page,
  browser,
}) => {
  await installMonsterPack(browser);
  const pack = (await (await page.request.get('/api/compendiums')).json())[0].id as string;

  const shelf = await createWorld(page, 'The Lit Shelf');
  const campaign = await createWorld(page, 'The Drawing Campaign');

  // One `shared` painting on the shelf, seeded over the API — this spec is about who reaches it, and
  // authoring it through the editor would say nothing the other specs do not.
  const painting = (
    await (
      await page.request.post('/api/entities', {
        data: { name: 'Sunset over Aldermoor', types: ['core.type.note'], worldId: shelf },
      })
    ).json()
  ).id as string;
  await page.request.patch(`/api/entities/${painting}`, { data: { visibility: 'shared' } });
  await addWorldMember(page, campaign, 'viewer');

  // The player has never heard of the shelf, so the painting is not there to open — Entity URLs are
  // World-scoped (ADR-0028), and this one names a World they cannot reach.
  const player = await signInGrantee(browser);
  await player.goto(`/entities/${painting}`);
  await expect(player.getByTestId('error-home')).toBeVisible();

  await page.goto(`/w/${campaign}/settings`);
  await page.getByTestId('settings-nav-mounts').click();
  await mount(page, shelf);
  await mount(page, pack);

  // One hop later the same URL opens, at the content's own World: following a link into a Mount
  // leaves your World, honestly and visibly.
  await player.goto(`/entities/${painting}`);
  await player.waitForURL(new RegExp(`/w/${segRe(shelf)}/entities/`));
  await expect(player.getByTestId('title')).toHaveText('Sunset over Aldermoor');
  await player.context().close();

  // And the reader with no account at all: the campaign's Public Link cascades to the pack it mounts,
  // so the terms that pack publishes under open to them too (ADR-0080).
  const token = (await (await page.request.post(`/api/worlds/${campaign}/link`)).json()).token as string;
  const anonContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonContext.newPage();
  await visitor.goto(`/public/w/${token}/compendium/${pack}`);
  await expect(visitor.getByTestId('compendium-name')).toHaveText('Draw Steel: Monsters');
  await expect(visitor.getByTestId('compendium-publisher')).toHaveText('MCDM Productions, LLC');
  await expect(visitor.getByTestId('compendium-license')).toHaveText('Draw Steel Creator License');
  // Nothing offers them a way into a World they have no standing in.
  await expect(visitor.getByTestId('compendium-back')).toHaveCount(0);
  await anonContext.close();
});
