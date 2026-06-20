import { expect, test } from './fixtures';

/**
 * The Region journey (issue #8): a region painted onto a hex survives a save and
 * reload. Like the paint and feature journeys it crosses every seam — canvas
 * input, a versioned save, and a load on reload. Region membership is an
 * independent set of coordinates (CONTEXT.md → Region), so we prove the round
 * trip with a direct API read of the persisted document (ADR-0009) and confirm
 * the legend re-renders the loaded region.
 */
test('paints a region onto a hex, saves, and the region survives a reload', async ({
  page,
  request,
}) => {
  await page.goto('/maps');
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /maps/:id.
  await expect(page).toHaveURL(/\/maps\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Creating a region arms its paint brush, so clicking the centre hex (the
  // canvas centres the world origin on load, so a plain click lands on (0,0))
  // adds that coordinate to the region — no terrain needed.
  await page.getByTestId('new-region').click();
  await canvas.click();

  // Wait on the real save round-trip (not just the button text, which rests at
  // 'Save' and would let the reload below race an in-flight PUT).
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/maps\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.getByTestId('save').click();
  await saved;
  await expect(page.getByTestId('save')).toHaveText('Save');

  // The seam under test: a fresh load re-fetches the saved map and the legend
  // re-renders the loaded region.
  await page.reload();
  await expect(page.getByLabel('Region name')).toHaveValue('Region 1');

  // And the persisted document really holds the region with that coordinate in
  // its membership set.
  const res = await request.get(`/api/maps/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.regions).toHaveLength(1);
  expect(detail.document.regions[0].hexes).toEqual({ '0,0': true });
});
