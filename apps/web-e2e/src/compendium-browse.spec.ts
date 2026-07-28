import { compendiumRailLink, enterEntities, expect, test } from './fixtures';

/**
 * The Compendium browse (ADR-0079, #401) as a user meets it: the rail's **Compendium** destination, the
 * Entity Browser preset over every installed pack, and an entry's own read-only page.
 *
 * Held to one journey (ADR-0009): the union across packs, the facet drill-down and the reachability rule
 * are asserted at the HTTP seam in `compendium-browse.controller.spec.ts`. What only a browser can show
 * is that the destination is *there*, lists what the pack landed, and opens an entry at a real URL under
 * the World it was browsed from — the World naming the adoption target rather than the content's home,
 * which is the seam Adoption hangs off (#403).
 *
 * The pack is the Draw Steel monsters Importer with its codeload fetch port swapped for the committed
 * Ajax + Goblin fixtures under the e2e opt-in (`E2eFixtureImporters`), so the run stays offline.
 */
test('the Compendium destination lists an installed pack, and an entry opens read-only under the browsing World', async ({
  page,
}) => {
  const worldSeg = await enterEntities(page);

  // Install the pack through the ordinary import surface, and wait for the reconcile to land.
  await page.goto(`/w/${worldSeg}/settings`);
  await page.getByTestId('settings-nav-imports').click();
  await page.getByTestId('importer-run-draw-steel.importer.monsters').click();
  await expect(page.getByTestId('importer-status-draw-steel.importer.monsters')).toContainText('2 entities', {
    timeout: 15_000,
  });

  // The rail's Compendium destination sits between Entities and Assets, and the World it carries is the
  // one being browsed from — not the pack's Container, which is in no World at all.
  await compendiumRailLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/w/${worldSeg}/compendium$`));

  // The pack's entries are listed, by the same card the Entity Browser uses.
  const goblin = page.getByText('Goblin Warrior', { exact: true });
  await expect(goblin).toBeVisible();
  const ajax = page.getByText('Ajax the Invincible', { exact: true });
  await expect(ajax).toBeVisible();

  // Search behaves as it does in the Entity Browser — there is no second way to search.
  await page.getByTestId('entity-search').fill('ajax');
  await expect(goblin).toHaveCount(0);
  await page.getByTestId('entity-search').fill('');
  await expect(goblin).toBeVisible();

  // The Facet rail behaves the same way too: a category narrows the list and rides the URL, so the
  // filtered browse is a link you can send. Role is the pack's own dimension, harvested from its stat
  // block (ADR-0055) — findable by what a monster is, not by remembering its name.
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

  // The card offers no rename and no delete: a **Compendium Entry**'s Rights are `read` alone, so the
  // shared card's ordinary gate hides both — nothing here is special-cased read-only.
  await expect(page.locator('[data-testid^="rename-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="delete-"]')).toHaveCount(0);

  // Opening an entry lands on its own Entity page at a real URL, still under the browsing World — the
  // segment is navigation context for something that lives in no World (ADR-0079).
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
});
