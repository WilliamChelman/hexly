import { enterLibrary, entityIdFromUrl, expect, flushSave, test } from './fixtures';

/** Full-stack note round-trip; the persisted snapshot is opaque (ADR-0009/0019). */
test('types into a note, saves, and the Content survives a reload', async ({ page, request }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = entityIdFromUrl(page);

  // Click 60% down to prove the whole box focuses the editor.
  const surface = page.getByTestId('note-content');
  const content = 'Lady Mara rules the northern reach.';
  const box = await surface.boundingBox();
  await surface.click({ position: { x: 60, y: (box?.height ?? 200) * 0.6 } });
  await page.keyboard.type(content);
  await expect(surface).toContainText(content);

  await flushSave(page);

  await page.reload();
  await expect(page.getByTestId('note-content')).toContainText(content);
  await expect(page.getByTestId('title')).toHaveText('Untitled note');

  const res = await request.get(`/api/entities/${noteId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  // A note's Entity Type lives in the entity-level `types` set, not in the body — which is
  // `{ content, metadata }` for every Entity (ADR-0050). `core.note` is the primary type.
  expect(detail.types).toContain('core.note');
  expect(detail.document.content.format).toBe('tiptap-v3'); // mirrors CONTENT_FORMAT
  expect(JSON.stringify(detail.document.content.snapshot)).toContain(content);
});
