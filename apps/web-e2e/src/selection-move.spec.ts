import { enterLibrary, expect, flushSave, test } from './fixtures';

/**
 * Group moves for non-hex selections (issue #64 follow-up, ADR-0017). Two bugs the
 * unified selection-drag fixes, each riding the real canvas press→drag gesture and
 * proven through a direct API read of the persisted document (ADR-0009):
 *
 * 1. Dragging a label that is part of a multi-selection moved only that one label
 *    and discarded the rest — it must move the whole set.
 * 2. A Region on its own could not be dragged at all — grabbing one of its member
 *    cells must translate its whole footprint.
 */

/** Read the saved document for `mapId` after a committed PUT. */
async function savedDocument(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext, mapId: string) {
  await flushSave(page);
  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).document;
}

test('drags one label of a multi-label selection and the whole group moves', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop() as string;

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const gap = 150; // labels far enough apart that their hit boxes never overlap

  await page.getByTestId('tool-label').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + gap, y: box.height / 2 } });

  // Select both: click the first, Shift-click the second.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({
    position: { x: box.width / 2 + gap, y: box.height / 2 },
    modifiers: ['Shift'],
  });

  const before = (await savedDocument(page, request, mapId)).labels as {
    id: string;
    position: { x: number; y: number };
  }[];
  expect(before).toHaveLength(2);

  // Drag ~80px right. Labels-only selection moves all by the same delta.
  const dx = 80;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  const after = (await savedDocument(page, request, mapId)).labels as {
    id: string;
    position: { x: number; y: number };
  }[];
  expect(after).toHaveLength(2);

  // Every label moved by the same ~+80px in x and held its y.
  for (const b of before) {
    const a = after.find((l) => l.id === b.id);
    expect(a, `label ${b.id} survived`).toBeTruthy();
    if (!a) continue;
    expect(a.position.x - b.position.x).toBeGreaterThan(60);
    expect(a.position.x - b.position.x).toBeLessThan(100);
    expect(Math.abs(a.position.y - b.position.y)).toBeLessThan(2);
  }
});

test('drags a region on its own and its whole footprint moves', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop() as string;

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = 100; // one column right (offset q+1)

  // Create a region and paint the centre (0,0) into its membership.
  await page.getByTestId('rail-regions').click();
  await page.getByTestId('new-region').click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');
  await canvas.click();

  // The region is still selected. Drag by grabbing its member cell.
  await page.getByTestId('tool-select').click();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  // The footprint translated by the offset.
  const doc = await savedDocument(page, request, mapId);
  expect(doc.regions).toHaveLength(1);
  expect(doc.regions[0].hexes).toEqual({ '1,0': true });
});
