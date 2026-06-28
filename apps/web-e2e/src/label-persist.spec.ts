import { enterLibrary, expect, flushSave, test } from './fixtures';

/**
 * The Label journey (issue #10): a free-positioned label placed on the map, its
 * text edited, survives a save and reload. Like the paint and feature journeys
 * it crosses every seam — canvas input, the inspector edit, a versioned save,
 * and a load on reload. A Label is free-positioned (a world point, not a hex),
 * so we prove the round trip with a direct API read of the persisted document
 * (ADR-0009) and confirm it re-renders by re-selecting it on the canvas.
 */
test('places a label, edits its text, saves, and it survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Arm the Label tool and drop a label at the canvas centre (the canvas centres
  // the world origin on load, so a plain click lands a label at world (0,0)).
  // Placing it selects it, so the inspector opens on its fields.
  await page.getByTestId('tool-label').click();
  await canvas.click();

  // Edit the placed label's text in the inspector. Tab blurs the field, which
  // fires the (change) the inspector commits on.
  const text = page.getByTestId('label-text');
  await text.fill('The Whisperwood');
  await text.press('Tab');

  await flushSave(page);

  // The persisted document really holds the label, free-positioned at a point.
  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.labels).toHaveLength(1);
  expect(detail.document.labels[0].text).toBe('The Whisperwood');
  expect(detail.document.labels[0].position).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
  });

  // The seam under test: a fresh load re-fetches and re-renders the saved map.
  // Clicking the centre re-selects the re-rendered label (proving it drew where
  // it was saved), and the inspector shows its persisted text.
  await page.reload();
  await canvas.click();
  await expect(page.getByTestId('label-text')).toHaveValue('The Whisperwood');
});
