import {
  enterEntities,
  entitiesRailLink,
  expect,
  installMonsterPack,
  installedPackId,
  libraryRailLink,
  mountContainer,
  test,
  unmountContainer,
} from './fixtures';

/**
 * The **Library** (#412, ADR-0080) as a user meets it: the rail's destination beside **Entities**, the
 * Entity Browser preset to what this World **Mounts**, and an entry adopted out of it.
 *
 * Held to one journey (ADR-0009): the union across Containers, the Container facet's drill-down and
 * order, and the reachability rule are asserted at the HTTP seam in `library-browse.controller.spec.ts`
 * and `world-mounts.controller.spec.ts`. What only a browser can show is that the destination is
 * *there*, that it is empty until something is mounted and full after, and that the Entity Browser
 * beside it never moved.
 *
 * The pack is the Draw Steel monsters Importer with its codeload fetch port swapped for the committed
 * Ajax + Goblin fixtures under the e2e opt-in (`E2eFixtureImporters`), so the run stays offline.
 */

/** What this file mounted and minted, put back afterwards: neither survives its own spec by design. */
const cleanup: Array<() => Promise<void>> = [];

test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
});

test('the Library lists what this World Mounts, credits the pack it draws from, and adopts an entry out of it', async ({
  page,
  browser,
}) => {
  // Stocked once by the operator, for the whole Instance (#404) — the browsing user never installs it.
  await installMonsterPack(browser);
  const pack = await installedPackId(page);
  const worldSeg = await enterEntities(page);

  // The rail's Library destination sits beside Entities: what this World draws on, beside what its
  // authors made. The World it carries is whose Mounts these are, not the content's home.
  await libraryRailLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/library$`));

  // Nothing is mounted automatically, not even an installed pack (ADR-0080), so the Library opens
  // empty — and says which emptiness this is rather than looking broken.
  await expect(page.getByTestId('no-mounts')).toContainText('This world draws on nothing yet.');
  await expect(page.getByText('Goblin Warrior', { exact: true })).toHaveCount(0);

  // A shelf of its own beside the pack, so the Library is shown to be about Containers rather than
  // about packs: two Mounts, two kinds, one list.
  const shelf = (await (await page.request.post('/api/worlds', { data: { name: 'The Lit Shelf' } })).json())
    .id as string;
  await page.request.post('/api/entities', {
    data: { name: 'Sunset over Aldermoor', types: ['core.type.note'], worldId: shelf },
  });
  await mountContainer(page, worldSeg, shelf);
  await mountContainer(page, worldSeg, pack);
  cleanup.push(async () => {
    await unmountContainer(page, worldSeg, pack);
    await page.request.delete(`/api/worlds/${shelf}`);
  });

  await page.reload();
  // Both Containers' Entities, by the same card the Entity Browser uses.
  const goblin = page.getByText('Goblin Warrior', { exact: true });
  const ajax = page.getByText('Ajax the Invincible', { exact: true });
  const painting = page.getByText('Sunset over Aldermoor', { exact: true });
  await expect(goblin).toBeVisible();
  await expect(ajax).toBeVisible();
  await expect(painting).toBeVisible();

  // Search behaves as it does in the Entity Browser — there is no second way to search.
  await page.getByTestId('entity-search').fill('ajax');
  await expect(goblin).toHaveCount(0);
  await page.getByTestId('entity-search').fill('');
  await expect(goblin).toBeVisible();

  // The Container facet: ADR-0079's pack facet widened, reading in the Owner's Mount order — the shelf
  // was mounted first, so it is listed first, which no alphabetical or by-count order would produce.
  const containers = page.locator('[data-testid^="facet-container-"]');
  await expect(containers).toHaveCount(2);
  await expect(containers.first()).toHaveAttribute('data-testid', `facet-container-${shelf}`);
  await expect(containers.last()).toHaveAttribute('data-testid', `facet-container-${pack}`);
  // It narrows to one mounted Container, and the narrowing rides the URL like every other category.
  await page.getByTestId(`facet-container-${pack}`).click();
  await expect(page).toHaveURL(new RegExp(`[?&]container=${pack}`));
  await expect(painting).toHaveCount(0);
  await expect(goblin).toBeVisible();
  await page.getByTestId('facet-clear').click();

  // And **Container** excludes like any other category (ADR-0081, #423): browse everything this World
  // Mounts *except* one pack — one click, rather than ticking every other Container.
  await page.getByTestId(`facet-exclude-container-${pack}`).click();
  await expect(page).toHaveURL(new RegExp(`[?&]excludeContainer=${pack}`));
  await expect(goblin).toHaveCount(0);
  await expect(ajax).toHaveCount(0);
  await expect(painting).toBeVisible();
  // The exclusion rides the URL, so a reload (and a shared link) reproduces the browse.
  await page.reload();
  await expect(page.getByTestId(`facet-exclude-container-${pack}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(goblin).toHaveCount(0);
  // Reversible by the same control — never a one-way door.
  await page.getByTestId(`facet-exclude-container-${pack}`).click();
  await expect(goblin).toBeVisible();
  await expect(painting).toBeVisible();

  // The rest of the rail behaves the same way too. Role is the pack's own dimension, harvested from
  // its stat block (ADR-0055) — findable by what a monster is, not by remembering its name.
  await page.getByTestId('facet-field-role-harrier').click();
  await expect(page).toHaveURL(/[?&]field=role:eq:harrier/);
  await expect(ajax).toHaveCount(0);
  await expect(goblin).toBeVisible();
  // A universal category — Type — reaches the wire and the URL as well; both survive a reload.
  await page.getByTestId('facet-clear').click();
  await page.getByTestId('facet-type-draw-steel.type.monster').click();
  await expect(page).toHaveURL(/[?&]type=draw-steel\.type\.monster/);
  await page.reload();
  await expect(page.getByTestId('facet-type-draw-steel.type.monster')).toHaveAttribute('aria-pressed', 'true');
  await expect(goblin).toBeVisible();
  await page.getByTestId('facet-clear').click();

  // A Compendium Entry's card offers no rename and no delete: its Rights are `read` alone, so the
  // shared card's ordinary gate hides both — nothing here is special-cased read-only.
  await expect(page.locator('[data-testid^="rename-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="delete-"]')).toHaveCount(0);

  // Opening an entry lands on its own Entity page at a real URL, still under the browsing World — the
  // segment is navigation context for something that lives in another Container (ADR-0079).
  await goblin.click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/entities/`));
  await expect(page.getByTestId('title')).toHaveText('Goblin Warrior');
  // Read-only where it counts: the title is not editable, and the actions menu — type edit, visibility,
  // pin, share — has nothing left to offer, so its trigger does not render at all.
  await expect(page.getByTestId('title')).not.toHaveAttribute('contenteditable', /.*/);
  await expect(page.getByTestId('entity-actions')).toHaveCount(0);

  // The URL is shareable: loading it directly resolves the entry rather than bouncing to its Container.
  const url = page.url();
  await page.goto(url);
  await expect(page.getByTestId('title')).toHaveText('Goblin Warrior');
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/entities/`));

  // Adoption is offered where the content is (ADR-0080): the copy-it-to-change-it path runs from the
  // Library, without a detour through a surface of its own.
  await libraryRailLink(page).click();
  const card = page.locator('app-entity-card').filter({ hasText: 'Goblin Warrior' });
  const entryId = (await card.locator('[data-testid^="open-"]').getAttribute('data-testid'))!.replace('open-', '');
  await page.getByTestId(`adopt-${entryId}`).click();
  await expect(page.locator('.toast', { hasText: 'Adopted' })).toBeVisible();

  // And the Entity Browser at the Entities destination is still this World's own work alone: the copy
  // adoption just made is there, and nothing that merely got Mounted is.
  await entitiesRailLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/entities$`));
  await expect(page.locator('app-entity-card')).toHaveCount(1);
  await expect(page.getByText('Goblin Warrior', { exact: true })).toBeVisible();
  await expect(page.getByText('Ajax the Invincible', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Sunset over Aldermoor', { exact: true })).toHaveCount(0);

  // The terms are stated where the content is read (ADR-0061, #402): the Library credits each mounted
  // Compendium by name, and the name opens the pack's own page — which stayed where it was.
  await libraryRailLink(page).click();
  await page.getByTestId('library-credits').getByText('Draw Steel: Monsters').click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/compendium/`));
  await expect(page.getByTestId('compendium-name')).toHaveText('Draw Steel: Monsters');
  await expect(page.getByTestId('compendium-publisher')).toHaveText('MCDM Productions, LLC');
  await expect(page.getByTestId('compendium-license')).toHaveText('Draw Steel Creator License');
  await expect(page.getByTestId('compendium-notice')).toContainText('not affiliated with MCDM Productions, LLC');
  // And back the way it was reached — the Library is where a pack's page hangs off now.
  await page.getByTestId('compendium-back').click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/library$`));
});
