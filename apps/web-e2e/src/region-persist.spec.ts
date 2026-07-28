import { createEntity, enterEntities, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * The Region journey (ADR-0012): a region created in the Regions panel and painted onto
 * a hex survives a save and reload. Region membership is an independent set of
 * coordinates (CONTEXT.md → Region).
 */
test('creates a region in the panel, paints a hex, saves, and the region survives a reload', async ({
  page,
  request,
}) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });
  // Measure while the Dock is closed: the world origin sits at this full-width centre and stays put
  // there when a Panel later pushes the map narrower (the canvas does not re-centre, ADR-0067), so
  // `box.width/2` keeps targeting origin (0,0) — the geometric centre of the pushed canvas would not.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const origin = { x: box.width / 2, y: box.height / 2 };

  // Create Region in the Regions Panel on the page Dock (ADR-0012, ADR-0067). New Region arms the Add brush.
  await page.getByTestId('map-regions-toggle').click();
  await page.getByTestId('new-region').click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

  // Click the centre hex to paint (0,0) into its membership.
  await canvas.click({ position: origin });

  await flushSave(page);

  await page.reload();

  const grid = await savedGrid(request, mapId);
  expect(grid.regions).toHaveLength(1);
  expect(grid.regions[0].hexes).toEqual({ '0,0': true });
  expect(grid.regions[0].name).toBe('Region 1');

  // The reloaded map boots in Select (issue #27). Wait for the re-fetched document to land in the
  // remembered Regions Panel (the region listed by name) so the canvas store holds its membership,
  // then click origin: Void inside a Region selects it (ADR-0011). Scope the assertion to the
  // Inspector's <input> — selecting swaps the Regions Panel (a same-testid <span>) for the Inspector,
  // and toHaveValue fatally rejects the transient <span> rather than awaiting the <input>.
  await expect(page.getByTestId('region-name')).toHaveText('Region 1');
  // A no-position click hits the canvas's geometric centre — which post-reload *is* the origin: the
  // remembered Regions Panel is open from the first render, so the canvas centres origin on its
  // already-narrow width (unlike the mid-session paint above, where the map had centred full-width
  // before the Panel pushed it).
  await canvas.click();
  await expect(page.locator('input[data-testid="region-name"]')).toHaveValue('Region 1');
});
