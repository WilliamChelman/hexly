import {
  authorWorldField,
  authorWorldType,
  createEntity,
  enterLibrary,
  expect,
  openDetails,
  test,
  type Page,
} from './fixtures';

/** A World Type whose only Field is ticked "required" — the arrangement both facts below need. */
async function authorKnight(page: Page): Promise<void> {
  const worldId = await enterLibrary(page);
  await authorWorldField(page, worldId, { segment: 'rank', label: 'Rank', required: true });
  await authorWorldType(page, worldId, { id: 'knight', name: 'Knight', fields: [], refs: ['world.field.rank'] });
  await enterLibrary(page);
}

/**
 * `required` prompts, it never gates (ADR-0074): a Type declaring one mints from the "New" split button
 * like any other, and the Entity lands **Incomplete** rather than unborn.
 */
test('the New button mints a Type carrying a required Field directly, with no create dialog', async ({
  page,
  request,
}) => {
  await authorKnight(page);
  const id = await createEntity(page, 'world.type.knight');

  // Straight onto the Entity: no create dialog stood between the click and the mint.
  await expect(page.getByTestId('create-entity-name')).toHaveCount(0);
  await expect(page.getByTestId('title')).toBeVisible();

  // And it really is a Knight, not something wearing the label.
  const detail = await request.get(`/api/entities/${id}`);
  expect(detail.ok(), `${detail.status()} ${await detail.text()}`).toBeTruthy();
  expect((await detail.json()).types).toEqual(['world.type.knight']);
});

/**
 * The Details panel is the one surface that reads the incompleteness back — the minimum replacement for
 * the gate, without which an Entity drifts Incomplete forever with nothing saying so (ADR-0074).
 */
test('the Details panel marks an unfilled required Field Incomplete, and clears it once filled', async ({ page }) => {
  await authorKnight(page);
  await createEntity(page, 'world.type.knight');
  await expect(page.getByTestId('title')).toBeVisible();

  await openDetails(page);
  const mark = page.getByTestId('detail-field-incomplete-world.field.rank');
  await expect(mark).toBeVisible();

  // The mark flags, it never blocks: the control beside it is live, and filling it clears the reading.
  await page.getByTestId('detail-field-world.field.rank').locator('input').fill('Baronet');
  await expect(mark).toHaveCount(0);
});
