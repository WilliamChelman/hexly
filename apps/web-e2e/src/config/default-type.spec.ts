import { enterEntities, entityIdFromUrl, expect, mapViewToggle, test } from '../fixtures';

/**
 * `entities.defaultType: core.type.hex-map` — an enabled non-note Type — via its own server (ADR-0052,
 * Seam 4; server in `playwright.config.ts`): the "New" button's primary action follows the knob.
 */

test('the primary "New" button is labelled after — and creates — the configured default Type', async ({
  page,
  request,
}) => {
  const res = await request.get('/api/config');
  expect(res.ok()).toBeTruthy();
  const config = await res.json();
  expect(config.entities.defaultType).toBe('core.type.hex-map');

  await enterEntities(page);

  // The primary button's copy is the resolved Type's create chrome (ADR-0052), not a static "New Note".
  const primary = page.getByTestId('new-default-entity');
  await expect(primary).toHaveText(/Create Map/);

  await primary.click();
  await page.waitForURL(/\/w\/[\w-]+\/entities\/[^/]+$/);
  const id = entityIdFromUrl(page);

  // A Hex Map opens on its map View — the primary Type's own default (ADR-0050).
  await expect(page.getByTestId(mapViewToggle())).toBeVisible();
  await expect(page.getByTestId('tool-terrain')).toBeVisible();

  // And it really is a Hex Map, not a Note wearing the label.
  const detail = await request.get(`/api/entities/${id}`);
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).types).toEqual(['core.type.hex-map']);
});
