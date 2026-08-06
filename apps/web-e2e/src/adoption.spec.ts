import type { Page } from '@playwright/test';
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
 * **Adoption** (ADR-0079, #403) as a user meets it — the two journeys the whole Compendium arc is
 * meant to end in, and the only ones held at this seam (ADR-0009): everything about what a copy *is*
 * lives in `compendium-adoption.controller.spec.ts`.
 *
 * Adoption runs from the **Library** now (ADR-0080, #412), so each journey Mounts the pack first —
 * nothing is mounted automatically, and an unmounted pack is not there to adopt from.
 *
 * The pack is the Draw Steel monsters Importer with its codeload fetch port swapped for the committed
 * Ajax + Goblin fixtures under the e2e opt-in, so the run stays offline.
 */

/** A Mount outlives the between-spec reset (ADR-0009), so a spec that declares one withdraws it. */
const mounted: Array<[world: string, container: string]> = [];

test.afterEach(async ({ page }) => {
  for (const [world, container] of mounted.splice(0)) await unmountContainer(page, world, container);
});

/**
 * The id behind the one card named `name` on the browse currently open. Both browses render the same
 * card, so this is how a spec tells the entry apart from the copy adoption made of it.
 */
async function cardId(page: Page, name: string): Promise<string> {
  const card = page.locator('app-entity-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  const testid = await card.locator('[data-testid^="open-"]').getAttribute('data-testid');
  return testid!.replace('open-', '');
}

/** Both browses render `app-entity-card`, so a spec must land on the destination before reading one. */
async function openLibrary(page: Page): Promise<void> {
  await libraryRailLink(page).click();
  await page.waitForURL(/\/library$/);
}

/** Enter a World and declare the installed pack one of the Containers it draws from (ADR-0080). */
async function enterWorldMountingThePack(page: Page): Promise<string> {
  const pack = await installedPackId(page);
  const worldSeg = await enterEntities(page);
  await mountContainer(page, worldSeg, pack);
  mounted.push([worldSeg, pack]);
  return worldSeg;
}

async function openEntities(page: Page): Promise<void> {
  await entitiesRailLink(page).click();
  await page.waitForURL(/\/entities$/);
}

test('browse the Library, adopt an entry, and the copy is an ordinary Entity of the World', async ({
  page,
  browser,
}) => {
  // Stocked once by the operator, for the whole Instance (#404) — an adopter never installs a pack.
  await installMonsterPack(browser);
  await enterWorldMountingThePack(page);

  await openLibrary(page);
  const entryId = await cardId(page, 'Goblin Warrior');
  await page.getByTestId(`adopt-${entryId}`).click();
  await expect(page.locator('.toast', { hasText: 'Adopted' })).toBeVisible();

  // The Entity Browser is where a World's own work lives, and the copy is now part of it — the entry
  // it came from is not, and never was.
  await openEntities(page);
  const copyId = await cardId(page, 'Goblin Warrior');
  expect(copyId).not.toBe(entryId);

  // Editable, which is the whole point: the card offers rename and delete, where the sealed one offered
  // neither, and a rename really lands.
  await expect(page.getByTestId(`delete-${copyId}`)).toBeVisible();
  await page.getByTestId(`rename-${copyId}`).click();
  const rename = page.getByTestId(`rename-input-${copyId}`);
  await rename.fill('Grix the Turncoat');
  await rename.press('Enter');

  // Surviving a reload: the copy is stored, not an optimistic row on a page that browsed a shelf.
  await page.reload();
  await expect(page.getByTestId(`open-${copyId}`)).toBeVisible();
  await expect(page.locator('app-entity-card').filter({ hasText: 'Grix the Turncoat' })).toHaveCount(1);
  // And the pack's own Goblin is still on the shelf, unrenamed — nothing was moved out of it.
  await openLibrary(page);
  expect(await cardId(page, 'Goblin Warrior')).toBe(entryId);
});

test('the mention picker offers the adopted Goblin ahead of the entry it was copied from', async ({
  page,
  browser,
}) => {
  await installMonsterPack(browser);
  await enterWorldMountingThePack(page);

  await openLibrary(page);
  const entryId = await cardId(page, 'Goblin Warrior');
  await page.getByTestId(`adopt-${entryId}`).click();
  await expect(page.locator('.toast', { hasText: 'Adopted' })).toBeVisible();

  await openEntities(page);
  const copyId = await cardId(page, 'Goblin Warrior');
  expect(copyId).not.toBe(entryId);

  // A note to write in, and an `@` mention of a name both the copy and the entry answer to.
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await page.getByTestId('note-content').click();
  await page.keyboard.type('@Goblin');
  await expect(page.getByTestId('entity-picker')).toBeVisible();

  // What Adoption bought, as a user meets it: the World's own Goblin — the one Adoption made — ranks
  // above the pack's, so `@Goblin` reaches the copy first. The entry is offered at all only because this
  // World **Mounts** the pack (ADR-0080); to a World that does not, it is as unreachable as ADR-0079's
  // seal ever made it, which is what `mounts.spec.ts` pins.
  await expect(page.locator('[data-testid^="entity-picker-option-"]').first()).toHaveAttribute(
    'data-testid',
    `entity-picker-option-${copyId}`,
  );

  // And choosing it links the copy, not the entry.
  await page.getByTestId(`entity-picker-option-${copyId}`).click();
  await expect(page.getByTestId('entity-link')).toHaveAttribute('data-entity-id', copyId);
});
