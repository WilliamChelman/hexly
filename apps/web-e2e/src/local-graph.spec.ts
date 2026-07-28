import { enterEntities, expect, openEntity, test, widenDockPanel } from './fixtures';

/** A tiptap doc whose one paragraph carries a prose Entity Link to `entityId` — a semantic edge. */
function proseLinking(entityId: string, label: string) {
  return {
    format: 'tiptap-v3',
    snapshot: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId, label } }] }],
    },
  };
}

/**
 * The Local Graph Panel journey (ADR-0072): the World Graph's drawing, centred on the open Entity, in the
 * page's Dock (ADR-0067). It opens one hop out — the Entity and what it links to directly — and the depth
 * control walks it further, refetching each time (the bound is the server's, not a client filter).
 *
 * A three-Entity chain, `Ealdred → Riverbend → Thornwood`, is the smallest World where one hop and two are
 * different pictures.
 */
test('the Local Graph panel opens one hop out and deepens on request', async ({ page }) => {
  await enterEntities(page);

  const create = async (name: string, linkTo?: { id: string; name: string }): Promise<string> => {
    const created = await page.request.post('/api/entities', {
      data: {
        name,
        types: ['core.type.note'],
        ...(linkTo ? { document: { 'core.field.content': proseLinking(linkTo.id, linkTo.name) } } : {}),
      },
    });
    expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
    return (await created.json()).id as string;
  };

  const far = await create('Thornwood');
  const middle = await create('Riverbend', { id: far, name: 'Thornwood' });
  const center = await create('Ealdred', { id: middle, name: 'Riverbend' });

  await openEntity(page, center);
  await page.getByTestId('local-graph-toggle').click();

  // One hop: Ealdred and Riverbend, the one link between them. Thornwood is a hop too far.
  const counts = page.getByTestId('local-graph-counts');
  await expect(counts).toContainText('2 entities');
  await expect(counts).toContainText('1 links');
  await expect(page.getByTestId('graph-canvas')).toBeVisible();
  await expect(page.getByTestId('local-graph-depth-1')).toHaveAttribute('aria-pressed', 'true');

  // Two hops: Thornwood joins, with the link that carried the walk to it.
  await page.getByTestId('local-graph-depth-2').click();
  await expect(counts).toContainText('3 entities');
  await expect(counts).toContainText('2 links');

  // The reach is a habit, not a peek: it survives the hop to another Entity (the Panel is page chrome,
  // remembered per user, so it stays open across the navigation).
  await openEntity(page, far);
  await expect(page.getByTestId('local-graph-depth-2')).toHaveAttribute('aria-pressed', 'true');
  // Thornwood's own neighbourhood, two hops out: Riverbend that links it, and Ealdred behind it.
  await expect(counts).toContainText('3 entities');
});

/**
 * The drawing is square, so it follows the resizeable Panel's width (ADR-0067) instead of letterboxing:
 * a fixed height would leave a widened Panel drawing the same short strip.
 */
test('the Local Graph drawing grows with the Panel it is drawn in', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 }); // tall enough that the 50vh cap can't bite
  await enterEntities(page);

  const created = await page.request.post('/api/entities', {
    data: { name: 'Emberhold', types: ['core.type.note'] },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  await openEntity(page, (await created.json()).id as string);

  await page.getByTestId('local-graph-toggle').click();
  const drawing = page.getByTestId('local-graph-box');
  const before = await drawing.boundingBox();
  if (!before) throw new Error('drawing not laid out');
  expect(before.height).toBeCloseTo(before.width, 0);

  await widenDockPanel(page, 150);

  const after = await drawing.boundingBox();
  if (!after) throw new Error('drawing not laid out');
  expect(after.width).toBeGreaterThan(before.width + 100);
  expect(after.height).toBeCloseTo(after.width, 0);

  // The one place the height stops following the width: a short viewport caps it at half, so the depth
  // control below stays in sight rather than being pushed out of the card.
  await page.setViewportSize({ width: 1500, height: 600 });
  const capped = await drawing.boundingBox();
  if (!capped) throw new Error('drawing not laid out');
  expect(capped.height).toBeLessThanOrEqual(301);
  await expect(page.getByTestId('local-graph-depth-1')).toBeInViewport();
});

/** An Entity nothing links to and that links to nothing is a graph of one — a claim, not an empty canvas. */
test('the Local Graph panel says so when the open Entity links to nothing', async ({ page }) => {
  await enterEntities(page);

  const created = await page.request.post('/api/entities', {
    data: { name: 'Unvisited Isle', types: ['core.type.note'] },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();

  await openEntity(page, (await created.json()).id as string);
  await page.getByTestId('local-graph-toggle').click();

  await expect(page.getByTestId('local-graph-isolated')).toBeVisible();
  await expect(page.getByTestId('local-graph-counts')).toContainText('1 entities');
});
