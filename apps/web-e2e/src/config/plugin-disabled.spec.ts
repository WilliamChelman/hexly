import { enterEntities, expect, openEntity, test } from '../fixtures';

/**
 * dnd disabled end-to-end via its own server, booted against a `hexly.yml` with
 * `features.plugin.dnd.enabled: false` (ADR-0052, Seam 4; server in `playwright.config.ts`). Enabled
 * companion: `plugin-enabled.spec.ts` (offer side) and `dnd-monster.spec.ts` (bespoke views).
 */

test('`/api/config` reports dnd disabled and both create surfaces drop its Type', async ({ page, request }) => {
  const res = await request.get('/api/config');
  expect(res.ok()).toBeTruthy();
  const config = await res.json();
  // content and hexmap stay enabled; only dnd is off.
  expect(config.plugins.dnd.enabled).toBe(false);
  expect(config.plugins.content.enabled).toBe(true);
  expect(config.plugins.hexmap.enabled).toBe(true);

  await enterEntities(page);

  // The "New" split button's type menu: still offers the enabled Types, but not the disabled Plugin's.
  await page.getByTestId('new-entity-menu').click();
  await expect(page.getByTestId('new-entity-core.type.note')).toBeVisible();
  await expect(page.getByTestId('new-entity-dnd.type.monster')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The Command Palette's create Commands fall out of the same registry (ADR-0032): a `>` search
  // surfaces the enabled Types' create Commands, never the disabled Plugin's.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>');
  await expect(page.getByTestId('command-palette-option-create-core.type.note')).toBeVisible();
  await page.getByTestId('command-palette-input').fill('>monster');
  await expect(page.getByTestId('command-palette-option-create-dnd.type.monster')).toHaveCount(0);
});

test('a pre-seeded dnd.type.monster opens on the generic Field View with its values shown', async ({
  page,
  request,
}) => {
  // Seed the monster over the API into the owner's starter World (worldId omitted → the server
  // defaults to it). With dnd disabled the Type resolves no Fields, so its values are plain Entity
  // Document keys — exactly the at-rest shape an enabled build would have stored, since a Field is
  // only a lens over the one document map (ADR-0051).
  const res = await request.post('/api/entities', {
    data: {
      name: 'Ancient Red Dragon',
      types: ['dnd.type.monster'],
      document: { challenge_rating: 24, strength: 30, size: 'Huge' },
    },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();

  await openEntity(page, id);

  await expect(page.getByTestId('title')).toHaveText('Ancient Red Dragon');

  // No bespoke stat block — the Plugin that ships it is absent. The Entity falls to the Details View
  // (ADR-0067), and the unregistered Type reads as a plain row there by its raw id.
  await expect(page.getByTestId('dnd.view.stat-block')).toHaveCount(0);
  await expect(page.getByTestId('stat-block-view')).toHaveCount(0);
  await expect(page.getByTestId('details-view')).toBeVisible();
  // The type manager's chip lists the unregistered Type by its raw id (#438).
  await expect(page.getByTestId('type-chip-dnd.type.monster')).toContainText('dnd.type.monster');

  // The values fall through to the plain-Entity-Document display, unhidden and readable.
  const plain = page.getByTestId('detail-plain');
  await expect(plain).toContainText('challenge_rating');
  await expect(plain).toContainText('24');
  await expect(plain).toContainText('strength');
  await expect(plain).toContainText('30');
  await expect(plain).toContainText('size');
  await expect(plain).toContainText('Huge');
});
