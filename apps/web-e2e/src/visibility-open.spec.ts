import {
  enterEntities,
  expect,
  flushSave,
  setEntityVisibility,
  setWorldOpen,
  signInGrantee,
  entityIdFromUrl,
  test,
} from './fixtures';
// The pretty-URL codec (ADR-0042), imported by path like the other framework-free e2e utils.
import { idFromSegment, segment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * The capstone of the ADR-0084 epic: the successor to the retired Public Link, end-to-end. An author
 * marks one Entity `open` and a second `shared` in an Open World; a second signed-in account that is
 * not a member reads both by their URLs — reachability gained the `open` and Open-World disjuncts —
 * while the Open World stays out of that account's World Index and Command Palette. Reachability
 * changed; listing did not (ADR-0084's invariant). Closing the World then isolates the two disjuncts:
 * the `shared` Entity goes dark, the `open` one stays reachable on its own rung.
 */
test('an open Entity and an Open World read for a signed-in non-member by URL, and stay unlisted', async ({
  page,
  browser,
}) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);

  // Entity A — marked `open`: reachable to any signed-in caller on the Instance (ADR-0084).
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const openId = entityIdFromUrl(page);
  await page.getByTestId('note-content').click();
  await page.keyboard.type('The lighthouse keeper guards a secret.');
  await flushSave(page);
  await setEntityVisibility(page, 'open');

  // Entity B — `shared`, in the same World: reachable to a non-member only once that World is Open.
  await page.goto(`/w/${worldSeg}/entities`);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const sharedId = entityIdFromUrl(page);
  await page.getByTestId('note-content').click();
  await page.keyboard.type('The tower burned at dawn.');
  await flushSave(page);
  await setEntityVisibility(page, 'shared');

  // Open the World — the successor to the World Public Link (ADR-0084).
  await setWorldOpen(page, worldSeg, true);

  // A second signed-in account that is NOT a member of this World reads both by their canonical URLs.
  const visitor = await signInGrantee(browser);

  await visitor.goto(`/w/${worldSeg}/entities/${segment(openId)}`);
  await expect(visitor.getByTestId('note-content')).toContainText('secret');

  await visitor.goto(`/w/${worldSeg}/entities/${segment(sharedId)}`);
  await expect(visitor.getByTestId('note-content')).toContainText('burned at dawn');

  // The `open` Entity was reachable by URL a moment ago, yet it lists nowhere for this non-member —
  // reachability never promotes to a listing surface, the "open lists nowhere" invariant (ADR-0084),
  // proven here end-to-end where the unit specs prove it at the query. In the Open World's own Entity
  // Browser a non-member enumerates nothing: the plain empty state, not the open note's row.
  await visitor.goto(`/w/${worldSeg}/entities`);
  await expect(visitor.getByTestId('empty')).toBeVisible();
  await expect(visitor.getByTestId(`open-${openId}`)).toHaveCount(0);

  // Its own prose is a full-text match (ADR-0046), so a search that WOULD surface it if listing followed
  // reachability instead reads "no matches" — the absence is the listing scope, not a missing index.
  await visitor.getByTestId('entity-search').fill('lighthouse');
  await expect(visitor.getByTestId('no-matches')).toBeVisible();
  await expect(visitor.getByTestId(`open-${openId}`)).toHaveCount(0);
  await visitor.getByTestId('entity-search').clear();

  // ...and the Command Palette, now scoped to this World (ADR-0083), searches the same listing: the open
  // note is no option of it either, though it opened by URL.
  await visitor.keyboard.press('ControlOrMeta+KeyK');
  await expect(visitor.getByTestId('command-palette-input')).toBeVisible();
  await visitor.getByTestId('command-palette-input').fill('lighthouse');
  await expect(visitor.getByTestId(`command-palette-option-${openId}`)).toHaveCount(0);
  await visitor.keyboard.press('Escape');

  // Yet the Open World is listed nowhere for them. Not the World Index feed ("the Worlds you have"):
  const worlds = (await (await visitor.request.get('/api/worlds')).json()) as { id: string }[];
  expect(worlds.some((w) => w.id === worldId)).toBe(false);

  // ...not the World Index page:
  await visitor.goto('/worlds');
  await expect(visitor.getByTestId(`world-${worldId}`)).toHaveCount(0);

  // ...and not the Command Palette, whose Worlds are the ones they have (ADR-0083).
  await visitor.keyboard.press('ControlOrMeta+KeyK');
  await expect(visitor.getByTestId('command-palette-input')).toBeVisible();
  await expect(visitor.getByTestId(`command-palette-option-${worldId}`)).toHaveCount(0);
  await visitor.keyboard.press('Escape');

  // Closing the World isolates the two disjuncts (ADR-0084): its `shared` Entity is no longer
  // reachable, but the `open` one still is, on its own rung — proving each disjunct is independent.
  await setWorldOpen(page, worldSeg, false);
  expect((await visitor.request.get(`/api/entities/${openId}`)).status()).toBe(200);
  expect((await visitor.request.get(`/api/entities/${sharedId}`)).ok()).toBe(false);

  await visitor.context().close();
});
