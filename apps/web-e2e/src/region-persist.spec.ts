import { expect, test } from './fixtures';

/**
 * The Region journey (issue #8, #38): a region create-and-painted onto a hex
 * survives a save and reload. Like the paint and feature journeys it crosses every
 * seam — canvas input, a versioned save, and a load on reload. Region membership is
 * an independent set of coordinates (CONTEXT.md → Region), so we prove the round
 * trip with a direct API read of the persisted document (ADR-0009) and confirm the
 * Inspector re-renders the loaded region after re-selecting it.
 */
test('create-and-paints a region onto a hex, saves, and the region survives a reload', async ({
  page,
  request,
}) => {
  await page.goto('/maps');
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /maps/:id.
  await expect(page).toHaveURL(/\/maps\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // A map opens armed with Select (issue #27). Arm the Region tool, then click the
  // centre hex (the canvas centres the world origin on load, so a plain click lands
  // on (0,0)): with no Region selected, the first stroke create-and-paints — it
  // mints 'Region 1', adds (0,0), and selects it (issue #38). No terrain needed.
  await page.getByTestId('tool-region').click();
  await canvas.click();

  // The minted Region is selected, so the Inspector shows its name field — the
  // earliest observable checkpoint (region membership has no status counter). The
  // Inspector renders a single region name input (no per-id suffix), so the bare
  // 'region-name' test id finds it.
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

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

  // The seam under test: a fresh load re-fetches the saved map.
  await page.reload();

  // Read the persisted document: it proves the round trip held the region with that
  // coordinate in its membership set, and its auto-assigned 'Region 1' name.
  const res = await request.get(`/api/maps/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.regions).toHaveLength(1);
  expect(detail.document.regions[0].hexes).toEqual({ '0,0': true });
  expect(detail.document.regions[0].name).toBe('Region 1');

  // The reloaded map boots in Select (issue #27). Clicking the centre hex selects
  // the Region that contains (0,0) — a Void coordinate inside a Region selects it
  // (ADR-0011) — and the Inspector re-renders its loaded name.
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');
});
