import {
  attachField,
  authorWorldField,
  authorWorldType,
  createEntity,
  enterLibrary,
  expect,
  flushSave,
  openEntityActions,
  test,
} from './fixtures';
import type { Page } from '@playwright/test';

/** The generic Field view's toggle — where an attached built-in Field's control renders (ADR-0054). */
const FIELDS_VIEW = 'core.view.fields';

/**
 * Show the generic Field view. It has a toggle only when the Entity affords a second view (a note gains
 * one on attaching a Field); a fields-only type opens on it outright, with no toggle to click.
 */
async function showFieldsView(page: Page): Promise<void> {
  const toggle = page.getByTestId(FIELDS_VIEW);
  if (await toggle.count()) await toggle.click();
}

/**
 * A World Owner authors a reusable `world.element` Field once, then attaches it to one deity but not
 * another — the headline payoff of first-class Fields (#230, mirroring `world-type-map.spec.ts`): one
 * deity has an elemental affinity, its neighbour does not, and no type was touched to say so. The same
 * Field is then reused on a plain note — one Field across two unrelated types.
 */
test('authors world.element, attaches it to one deity but not another, and reuses it across types', async ({
  page,
  request,
}) => {
  const worldId = await enterLibrary(page);

  // Author `world.element` (fire/ice/water) in the World Fields editor, and a `world.deity` type beside
  // it. The Fields list shows each Field's Data Type — a "Choice" for the enum.
  await authorWorldField(page, worldId, {
    segment: 'element',
    label: 'Element',
    kind: 'enum',
    options: 'fire, ice, water',
  });
  await expect(page.getByTestId('field-type-world.element')).toHaveText('Choice');
  await authorWorldType(page, worldId, {
    id: 'deity',
    name: 'Deity',
    fields: [{ segment: 'domain', label: 'Domain' }],
  });

  // Deity A: attach `world.element` — a Field its type never named — fill it, and persist.
  await enterLibrary(page);
  const pelor = await createEntity(page, 'world.deity');
  await expect(page.getByTestId('title')).toBeVisible();
  await attachField(page, 'world.element');

  await showFieldsView(page);
  const element = page.getByTestId('field-world.element').locator('select');
  await expect(element).toBeVisible();
  await element.selectOption('fire');

  const saved = await flushSave(page);
  const body = await saved.json();
  expect(body.document).toMatchObject({ 'world.element': 'fire' });
  expect(body.fields).toEqual(['world.element']);

  await page.reload();
  await showFieldsView(page);
  await expect(page.getByTestId('field-world.element').locator('select')).toHaveValue('fire');

  // Deity B: no attachment. One deity carries an element, its neighbour does not — and the Field is
  // still on offer, proving deity A's choice consumed nothing.
  await enterLibrary(page);
  await createEntity(page, 'world.deity');
  await openEntityActions(page);
  await page.getByTestId('edit-fields').click();
  await expect(page.getByTestId('field-chip-world.element')).toHaveCount(0);
  await expect(page.getByTestId('field-add').locator('option[value="world.element"]')).toHaveCount(1);
  await page.getByTestId('fields-close').click();

  // Reuse across an unrelated type: the same `world.element` rides a plain `core.note`.
  await enterLibrary(page);
  const note = await createEntity(page, 'core.note');
  await attachField(page, 'world.element');
  await showFieldsView(page);
  await page.getByTestId('field-world.element').locator('select').selectOption('ice');

  const savedNote = await flushSave(page);
  expect((await savedNote.json()).document).toMatchObject({ 'world.element': 'ice' });
  expect(pelor).not.toEqual(note); // two distinct Entities of two unrelated types, one shared Field
});
