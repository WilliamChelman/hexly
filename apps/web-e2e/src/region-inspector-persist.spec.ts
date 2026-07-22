import { createEntity, enterLibrary, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * The Inspector is the only place a Region's details are edited (CONTEXT.md → Inspector, ADR-0011).
 */
test('selects a Region on the canvas, renames it in the Inspector, and the rename survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });
  // Measure while the Dock is closed: the world origin sits at this full-width centre and stays put
  // there when a Panel later pushes the map narrower (the canvas does not re-centre, ADR-0067), so
  // `box.width/2` keeps targeting origin (0,0) — the geometric centre of the pushed canvas would not.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const origin = { x: box.width / 2, y: box.height / 2 };

  // Create Region from the Regions Panel on the page Dock (ADR-0012, ADR-0067). New Region arms the Add brush.
  await page.getByTestId('map-regions-toggle').click();
  await page.getByTestId('new-region').click();
  await canvas.click({ position: origin });

  // Select that Region on the canvas. Clicking (0,0) — a Void inside the Region —
  // selects it (ADR-0011), opening the Inspector on its name field.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: origin });
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

  // Tab blurs the field, firing the (change) the Inspector commits on.
  const name = page.getByTestId('region-name');
  await name.fill('The Whisperwood');
  await name.press('Tab');

  await flushSave(page);

  await page.reload();

  const grid = await savedGrid(request, mapId);
  expect(grid.regions).toHaveLength(1);
  expect(grid.regions[0].name).toBe('The Whisperwood');
  expect(grid.regions[0].hexes).toEqual({ '0,0': true });

  // The reloaded map boots in Select (issue #27). Wait for the re-fetched document to land in the
  // remembered Regions Panel (the region listed by its renamed value) so the canvas store holds its
  // membership, then click origin. Scope the assertion to the Inspector's <input> — selecting swaps
  // the Regions Panel (a same-testid <span>) for the Inspector, and toHaveValue fatally rejects the
  // transient <span> rather than awaiting the <input>.
  await expect(page.getByTestId('region-name')).toHaveText('The Whisperwood');
  // A no-position click hits the canvas's geometric centre — which post-reload *is* the origin: the
  // remembered Regions Panel is open from the first render, so the canvas centres origin on its
  // already-narrow width (unlike the mid-session clicks above, where the map had centred full-width
  // before the Panel pushed it).
  await canvas.click();
  await expect(page.locator('input[data-testid="region-name"]')).toHaveValue('The Whisperwood');
});
