import { authorWorldField, createEntity, enterLibrary, expect, flushSave, openEntityActions, test } from './fixtures';

/** The generic Field view's toggle — the home an attached built-in Field's control renders in (ADR-0054). */
const FIELDS_VIEW = 'core.view.fields';

/**
 * Attach / detach a registered **Field** on a single Entity (ADR-0054, #229): a worldbuilder reuses a
 * World-authored scalar Field on a plain `core.note` its type never named, fills it, and detaches it
 * again — the additive instance layer. (The dnd scalar Fields retired, ADR-0055, so a World Field is the
 * scalar-attach fixture now; the structured attach-and-afford path is `stat-block-attach.spec.ts`.)
 */
test('attaches a reused World Field to a note, persists its value, and detaches it', async ({ page, request }) => {
  const worldId = await enterLibrary(page);
  // A reusable World enum Field — no type declares it; it exists to be attached.
  await authorWorldField(page, worldId, {
    id: 'size',
    key: 'size',
    label: 'Size',
    kind: 'enum',
    options: 'Tiny, Small, Medium, Large, Huge, Gargantuan',
  });

  await enterLibrary(page);
  const id = await createEntity(page, 'core.note');
  await expect(page.getByTestId('title')).toBeVisible();
  // A plain note affords its Content View alone — no view toggle, no attached Fields yet.
  await expect(page.getByTestId(FIELDS_VIEW)).toHaveCount(0);

  // Attach `world.size` — a Field the note's type never declared — through the Edit-fields dialog.
  await openEntityActions(page);
  await page.getByTestId('edit-fields').click();
  await page.getByTestId('field-add').selectOption('world.size');
  await expect(page.getByTestId('field-chip-world.size')).toBeVisible();
  await page.getByTestId('fields-close').click();

  // The attachment appends the generic Field view, where the built-in Field's control now lives.
  await expect(page.getByTestId(FIELDS_VIEW)).toBeVisible();
  await page.getByTestId(FIELDS_VIEW).click();

  // Attached-but-empty, it renders as an empty control before it is filled.
  const size = page.getByTestId('field-size').locator('select');
  await expect(size).toBeVisible();
  await expect(size).toHaveValue('');
  await size.selectOption('Huge');

  const saved = await flushSave(page);
  // The value lands in the one EntityDocument map; the attachment persists in `fields[]`.
  const body = await saved.json();
  expect(body.document).toMatchObject({ size: 'Huge' });
  expect(body.fields).toEqual(['world.size']);

  await page.reload();
  await page.getByTestId(FIELDS_VIEW).click();
  await expect(page.getByTestId('field-size').locator('select')).toHaveValue('Huge');

  // Detach it: the Field drops from `fields[]` and its value is cleared from the document.
  await openEntityActions(page);
  await page.getByTestId('edit-fields').click();
  await page.getByTestId('field-detach-world.size').click();
  await expect(page.getByTestId('field-chip-world.size')).toHaveCount(0);
  await page.getByTestId('fields-close').click();

  // With no attached Field left, the note affords its Content View alone — the toggle disappears.
  await expect(page.getByTestId(FIELDS_VIEW)).toHaveCount(0);

  await flushSave(page);
  const res = await request.get(`/api/entities/${id}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.size).toBeUndefined();
  expect(detail.fields ?? []).toEqual([]);
});
