import { createEntity, enterEntities, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * A Label is free-positioned (a world point, not a hex). Its text survives a save and
 * reload: proven with a direct API read of the persisted document (ADR-0009), then by
 * re-selecting it on the canvas to show it re-rendered where it was saved.
 */
test('places a label, edits its text, saves, and it survives a reload', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Placing a label at the canvas centre selects it, opening the inspector.
  await page.getByTestId('tool-label').click();
  await canvas.click();

  // Tab blurs the field, firing the (change) the inspector commits on.
  const text = page.getByTestId('label-text');
  await text.fill('The Whisperwood');
  await text.press('Tab');

  await flushSave(page);

  const grid = await savedGrid(request, mapId);
  expect(grid.labels).toHaveLength(1);
  expect(grid.labels[0].text).toBe('The Whisperwood');
  expect(grid.labels[0].position).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
  });

  // Clicking the centre re-selects the re-rendered label (proving it drew where saved).
  await page.reload();
  await canvas.click();
  await expect(page.getByTestId('label-text')).toHaveValue('The Whisperwood');
});
