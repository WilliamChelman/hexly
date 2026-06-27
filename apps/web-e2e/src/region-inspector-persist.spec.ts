import { expect, test } from './fixtures';

/**
 * The Region select-and-edit journey (issue #39): a Region selected on the canvas
 * with the universal Select tool, renamed in the Inspector — the only place a
 * Region's details are edited (CONTEXT.md → Inspector, ADR-0011) — survives a save
 * and reload. Like the other entity journeys it crosses every seam: canvas
 * selection, the Inspector edit, a versioned save, and a load on reload. We prove
 * the round trip with a direct API read of the persisted document (ADR-0009) and
 * confirm the Inspector re-renders the renamed Region after re-selecting it.
 */
test('selects a Region on the canvas, renames it in the Inspector, and the rename survives a reload', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Seed a Region from the Regions panel (ADR-0012): open the rail's Regions panel and
  // create one. New Region mints 'Region 1', selects it, and arms the Add brush, so a
  // click on the centre hex (the canvas centres the world origin on load, so a plain
  // click lands on (0,0)) paints (0,0) into its membership.
  await page.getByTestId('rail-regions').click();
  await page.getByTestId('new-region').click();
  await canvas.click();

  // Now the journey under test: select that Region on the canvas with the universal
  // Select tool. Clicking (0,0) — a Void coordinate inside the Region — selects it
  // (ADR-0011), so the Inspector opens on its name field.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

  // Edit the selected Region's name in the Inspector. Tab blurs the field, which
  // fires the (change) the Inspector commits on.
  const name = page.getByTestId('region-name');
  await name.fill('The Whisperwood');
  await name.press('Tab');

  // Wait on the real save round-trip (not just the button text, which rests at
  // 'Save' and would let the reload below race an in-flight PUT).
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  // The seam under test: a fresh load re-fetches the saved map.
  await page.reload();

  // The persisted document really holds the renamed Region with its membership.
  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.regions).toHaveLength(1);
  expect(detail.document.regions[0].name).toBe('The Whisperwood');
  expect(detail.document.regions[0].hexes).toEqual({ '0,0': true });

  // The reloaded map boots in Select (issue #27). Clicking the centre re-selects the
  // re-rendered Region, and the Inspector shows its persisted, renamed value.
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('The Whisperwood');
});
