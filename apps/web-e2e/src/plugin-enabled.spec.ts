import { enterEntities, expect, test } from './fixtures';

/**
 * The enabled companion to `config/plugin-disabled.spec.ts` (ADR-0052, Seam 4): with no `hexly.yml`
 * every Plugin is enabled (opt-out default), so dnd's Type is offered on both create surfaces.
 * `dnd-monster.spec.ts` carries the bespoke-views half.
 */

test('`/api/config` reports dnd enabled and both create surfaces offer its Type', async ({ page, request }) => {
  const res = await request.get('/api/config');
  expect(res.ok()).toBeTruthy();
  const config = await res.json();
  expect(config.plugins.dnd.enabled).toBe(true);

  await enterEntities(page);

  // The "New" split button's type menu offers the Plugin's Type.
  await page.getByTestId('new-entity-menu').click();
  await expect(page.getByTestId('new-entity-dnd.type.monster')).toBeVisible();
  await page.keyboard.press('Escape');

  // As does the Command Palette's `>` create Commands.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>monster');
  await expect(page.getByTestId('command-palette-option-create-dnd.type.monster')).toBeVisible();
});
