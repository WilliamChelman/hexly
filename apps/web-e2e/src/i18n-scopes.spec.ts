import { createEntity, enterLibrary, expect, test } from './fixtures';

/**
 * Each lib's catalog is a Transloco scope, fetched separately from the app's root one (ADR-0049).
 * The failure this catches: copy that renders in English but never follows a language switch, because
 * nothing re-resolved the lib's keys once its catalog landed.
 *
 * The hex map is the sharpest case: its scope arrives with a plugin's provider and is eager, so no
 * pipe of the plugin's own reloads it on a switch. The app must load the catalog and then re-announce
 * the language, or the map renders raw keys for good (ADR-0049's amendment).
 */
test('a plugin’s scoped copy follows a language switch: the map editor flips to French', async ({ page }) => {
  await enterLibrary(page);
  await createEntity(page, 'core.type.hex-map');

  // App copy read through `translateSignal`, which prefixes its key with any injected scope — so a
  // lib's scope reaching this injector would render the raw 'dnd.entityTags.addPlaceholder'
  // (ADR-0049). No TestBed can catch that: the testing harness registers catalogs, not scopes.
  await expect(page.getByPlaceholder('Add tags…')).toBeVisible();

  // The map plugin's copy, in English: the canvas label and the tool palette group.
  await expect(page.getByRole('img', { name: 'Hex map' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Tools' })).toBeVisible();

  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Français' }).click();

  // The same map-plugin copy, now French — in place, with no reload and no navigation.
  await expect(page.getByRole('img', { name: 'Carte hexagonale' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Outils' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Tools' })).toHaveCount(0);
});
