import { authorWorldField, createEntity, enterEntities, expect, flushSave, openDetails, test } from './fixtures';

/**
 * Attach / detach a registered **Field** on a single Entity (ADR-0054, #229), now entirely through the
 * Details Panel's inline management (ADR-0067 — the Edit-fields dialog is retired): a worldbuilder reuses
 * a World-authored scalar Field on a plain `core.type.note` its type never named, fills it in place, and
 * detaches it again. The attachment adds **no** view toggle — a plain Field affords no View of its own;
 * it lives in the Details Panel beside the note's Content View.
 */
test('attaches a reused World Field to a note inline, persists its value, and detaches it', async ({
  page,
  request,
}) => {
  const worldId = await enterEntities(page);
  // A reusable World enum Field — no type declares it; it exists to be attached.
  await authorWorldField(page, worldId, {
    segment: 'size',
    label: 'Size',
    kind: 'enum',
    options: 'Tiny, Small, Medium, Large, Huge, Gargantuan',
  });

  await enterEntities(page);
  const id = await createEntity(page, 'core.type.note');
  await expect(page.getByTestId('title')).toBeVisible();
  // A plain note affords its Content View alone — no view toggle for the attached Field (ADR-0067).
  await expect(page.getByTestId('core.view.details')).toHaveCount(0);

  // Attach `world.field.size` — a Field the note's type never declared — through the Details Panel's
  // inline attach. The note has a Content View, so `openDetails` opens the Dock's Details Panel.
  await openDetails(page);
  await page.getByTestId('detail-field-add').selectOption('world.field.size');

  // Attached-but-empty, it renders as an empty control in place, right in the panel.
  const size = page.getByTestId('detail-field-world.field.size').locator('select');
  await expect(size).toBeVisible();
  await expect(size).toHaveValue('');
  await size.selectOption('Huge');

  const saved = await flushSave(page);
  // The value lands in the one EntityDocument map; the attachment *is* that namespaced key (ADR-0057),
  // so its presence in the document is the whole record — there is no separate `fields[]`.
  const body = await saved.json();
  expect(body.document).toMatchObject({ 'world.field.size': 'Huge' });

  await page.reload();
  await openDetails(page);
  await expect(page.getByTestId('detail-field-world.field.size').locator('select')).toHaveValue('Huge');

  // Detach it inline: discarding the Field deletes its key from the document entirely (ADR-0057).
  await page.getByTestId('detail-field-detach-world.field.size').click();
  await expect(page.getByTestId('detail-field-world.field.size')).toHaveCount(0);

  await flushSave(page);
  const res = await request.get(`/api/entities/${id}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  // Discard deletes the key entirely — no attachment, no value (ADR-0057).
  expect(detail.document['world.field.size']).toBeUndefined();
});
