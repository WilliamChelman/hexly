import {
  attachField,
  authorWorldField,
  createEntity,
  enterLibrary,
  expect,
  openDetails,
  openEntity,
  openEntityActions,
  test,
} from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG — enough for the upload path to mint an Asset (ADR-0065).
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * **System-managed** (ADR-0068): `core.type.asset` and `core.field.asset` are minted and owned by the
 * upload path alone, never authored. Every shape-editing surface derives from the one projected marker —
 * the add-type and attach-field pickers stop offering them, and the Details panel lists them affordance-less.
 * These two specs pin that behavior at the highest seam (prior art: `attach-field.spec.ts`, `asset-detail.spec.ts`).
 */
test('pickers never offer the System-managed asset type or asset-ref field', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  // A reusable World Field guarantees the attach picker renders, so its *absence* of the asset-ref is meaningful.
  await authorWorldField(page, worldSeg, { segment: 'origin', label: 'Origin' });

  await enterLibrary(page);
  await createEntity(page, 'core.type.note');
  await openDetails(page);

  // The Details panel's inline add-type picker offers ordinary types but never the System-managed asset type.
  await expect(page.getByTestId('detail-type-add')).toBeVisible();
  await expect(page.getByTestId('detail-type-add').locator('option[value="core.type.asset"]')).toHaveCount(0);

  // The attach-field picker offers the reusable World Field but never the System-managed asset-ref Field.
  const fieldAdd = page.getByTestId('detail-field-add');
  await expect(fieldAdd.locator('option[value="world.field.origin"]')).toHaveCount(1);
  await expect(fieldAdd.locator('option[value="core.field.asset"]')).toHaveCount(0);

  // The header's Edit-types dialog is the second add-type picker; it too must not offer the asset type.
  await openEntityActions(page);
  await page.getByTestId('edit-types').click();
  await expect(page.getByTestId('type-add')).toBeVisible();
  await expect(page.getByTestId('type-add').locator('option[value="core.type.asset"]')).toHaveCount(0);
});

test("an Asset's Details panel lists its System-managed type and field affordance-less", async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg); // the raw id the API keys on
  // A reusable World Field to attach later — proving an ordinary Field keeps its detach × beside the affordance-less asset-ref.
  await authorWorldField(page, worldSeg, { segment: 'origin', label: 'Origin' });

  // Mint an Asset through the ordinary upload path (ADR-0065); it returns the wrapper Entity.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'sigil.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const asset = await uploaded.json();

  await openEntity(page, asset.id);
  await openDetails(page);

  // The panel honestly shows the Entity's shape: the asset type and the asset-ref Field are both listed.
  await expect(page.getByTestId('detail-type-core.type.asset')).toBeVisible();
  await expect(page.getByTestId('detail-field-core.field.asset')).toBeVisible();

  // But neither carries an affordance: the system alone assigns/removes them (ADR-0068).
  await expect(page.getByTestId('detail-type-remove-core.type.asset')).toHaveCount(0);
  await expect(page.getByTestId('detail-field-detach-core.field.asset')).toHaveCount(0);

  // Add an ordinary second type: it is removable (a two-type set clears the last-type guard), yet the asset
  // type still shows no remove — proving the suppression is System-managed-specific, not the last-type rule.
  await page.getByTestId('detail-type-add').selectOption('core.type.note');
  await expect(page.getByTestId('detail-type-remove-core.type.note')).toBeVisible();
  await expect(page.getByTestId('detail-type-remove-core.type.asset')).toHaveCount(0);

  // An ordinary attached Field keeps its detach × — the affordance-less rule is the marker's, not the panel's.
  await attachField(page, 'world.field.origin');
  await expect(page.getByTestId('detail-field-detach-world.field.origin')).toBeVisible();
});
