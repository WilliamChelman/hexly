import { authorWorldField, authorWorldType, createEntity, enterLibrary, expect, test } from './fixtures';

/**
 * `required` prompts, it never gates (ADR-0074): a Type declaring one mints from the "New" split button
 * like any other, and the Entity lands **Incomplete** rather than unborn.
 */
test('the New button mints a Type carrying a required Field directly, with no create dialog', async ({
  page,
  request,
}) => {
  const worldId = await enterLibrary(page);

  // A World Field ticked "required", referenced by a World Type.
  await authorWorldField(page, worldId, { segment: 'rank', label: 'Rank', required: true });
  await authorWorldType(page, worldId, {
    id: 'knight',
    name: 'Knight',
    fields: [],
    refs: ['world.field.rank'],
  });

  await enterLibrary(page);
  const id = await createEntity(page, 'world.type.knight');

  // Straight onto the Entity: no create dialog stood between the click and the mint.
  await expect(page.getByTestId('create-entity-name')).toHaveCount(0);
  await expect(page.getByTestId('title')).toBeVisible();

  // And it really is a Knight, not something wearing the label.
  const detail = await request.get(`/api/entities/${id}`);
  expect(detail.ok(), `${detail.status()} ${await detail.text()}`).toBeTruthy();
  expect((await detail.json()).types).toEqual(['world.type.knight']);
});
