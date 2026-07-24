import {
  attachField,
  authorWorldField,
  authorWorldType,
  createEntity,
  enterLibrary,
  expect,
  flushSave,
  openDetails,
  test,
} from './fixtures';

/**
 * A World Owner authors a reusable `world.field.element` Field once, then attaches it to one deity but not
 * another — the headline payoff of first-class Fields (#230, mirroring `world-type-map.spec.ts`): one
 * deity has an elemental affinity, its neighbour does not, and no type was touched to say so. The same
 * Field is then reused on a plain note — one Field across two unrelated types. All management is inline
 * through the Details View/Panel (ADR-0067 — the Edit-fields dialog is retired).
 */
test('authors world.field.element, attaches it to one deity but not another, and reuses it across types', async ({
  page,
  request,
}) => {
  const worldId = await enterLibrary(page);

  // Author `world.field.element` (fire/ice/water) in the World Fields editor, and a `world.type.deity` type beside
  // it. The Fields list shows each Field's Data Type — a "Choice" for the enum.
  await authorWorldField(page, worldId, {
    segment: 'element',
    label: 'Element',
    kind: 'enum',
    options: 'fire, ice, water',
  });
  await expect(page.getByTestId('field-type-world.field.element')).toHaveText('Choice');
  await authorWorldType(page, worldId, {
    id: 'deity',
    name: 'Deity',
    fields: [{ segment: 'domain', label: 'Domain' }],
  });

  // Deity A: a scalar-only type affords no other View, so it opens full-width on the Details View. Attach
  // `world.field.element` — a Field its type never named — fill it in place, and persist.
  await enterLibrary(page);
  const pelor = await createEntity(page, 'world.type.deity');
  await expect(page.getByTestId('title')).toBeVisible();
  await attachField(page, 'world.field.element');

  const element = page.getByTestId('detail-field-world.field.element').locator('select');
  await expect(element).toBeVisible();
  await element.selectOption('fire');

  const saved = await flushSave(page);
  const body = await saved.json();
  // The `world.field.element` key's presence in the document *is* the attachment (ADR-0057) — no `fields[]`.
  expect(body.document).toMatchObject({ 'world.field.element': 'fire' });

  await page.reload();
  await openDetails(page);
  await expect(page.getByTestId('detail-field-world.field.element').locator('select')).toHaveValue('fire');

  // Deity B: no attachment. One deity carries an element, its neighbour does not — and the Field is
  // still on offer, proving deity A's choice consumed nothing.
  await enterLibrary(page);
  await createEntity(page, 'world.type.deity');
  await openDetails(page);
  await expect(page.getByTestId('detail-field-world.field.element')).toHaveCount(0);
  await expect(page.getByTestId('detail-field-add').locator('option[value="world.field.element"]')).toHaveCount(1);

  // Reuse across an unrelated type: the same `world.field.element` rides a plain `core.type.note`, whose
  // Content View means the Details management lives in the Dock Panel.
  await enterLibrary(page);
  const note = await createEntity(page, 'core.type.note');
  await attachField(page, 'world.field.element');
  await page.getByTestId('detail-field-world.field.element').locator('select').selectOption('ice');

  const savedNote = await flushSave(page);
  expect((await savedNote.json()).document).toMatchObject({ 'world.field.element': 'ice' });
  expect(pelor).not.toEqual(note); // two distinct Entities of two unrelated types, one shared Field
});
