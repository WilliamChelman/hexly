import { enterLibrary, expect, openEntity, test } from './fixtures';

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
  await enterLibrary(page);

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

/** An Entity nothing links to and that links to nothing is a graph of one — a claim, not an empty canvas. */
test('the Local Graph panel says so when the open Entity links to nothing', async ({ page }) => {
  await enterLibrary(page);

  const created = await page.request.post('/api/entities', {
    data: { name: 'Unvisited Isle', types: ['core.type.note'] },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();

  await openEntity(page, (await created.json()).id as string);
  await page.getByTestId('local-graph-toggle').click();

  await expect(page.getByTestId('local-graph-isolated')).toBeVisible();
  await expect(page.getByTestId('local-graph-counts')).toContainText('1 entities');
});

/**
 * Opening the panel must not freeze the page: the WebGL device the drawing needs is warmed during
 * browser idle time, so the click that opens the panel pays layout and render, never context
 * creation + shader compile (~700ms measured without the warm-up).
 */
test('opening the panel does not block the main thread', async ({ page }) => {
  // cosmos.gl cools its layout once per animation frame, so the settled mark is ~930 *frames* away
  // however fast they come: ~8 s on a 120 Hz display, ~16 s at 60 Hz, longer on CI's headless
  // compositor. The wait below is sized for the slow end, and this test's budget for the wait.
  test.setTimeout(90_000);

  await page.addInitScript(() => {
    (window as unknown as { __longtasks: number[] }).__longtasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        (window as unknown as { __longtasks: number[] }).__longtasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });

  await enterLibrary(page);
  const far = await page.request.post('/api/entities', {
    data: { name: 'Farhold', types: ['core.type.note'] },
  });
  expect(far.ok()).toBeTruthy();
  const farId = (await far.json()).id as string;
  const created = await page.request.post('/api/entities', {
    data: {
      name: 'Ashvale',
      types: ['core.type.note'],
      document: { 'core.field.content': proseLinking(farId, 'Farhold') },
    },
  });
  expect(created.ok()).toBeTruthy();
  await openEntity(page, (await created.json()).id as string);

  // Give the idle warm-up its window — the page is settled and doing nothing here.
  await page.waitForTimeout(2000);

  const before = await page.evaluate(() => (window as unknown as { __longtasks: number[] }).__longtasks.length);
  await page.getByTestId('local-graph-toggle').click();
  await expect(page.getByTestId('graph-canvas')).toBeVisible();
  // An adopted graph must still run its physics: the settled mark only appears once the force
  // simulation has actually ticked the layout past the readable threshold.
  await expect(page.getByTestId('graph-canvas')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
  await page.waitForTimeout(1200);

  const blocks = await page.evaluate(
    (n) => (window as unknown as { __longtasks: number[] }).__longtasks.slice(n),
    before,
  );
  expect(Math.max(0, ...blocks), `main-thread blocks on panel open: ${JSON.stringify(blocks)}`).toBeLessThan(300);
});
