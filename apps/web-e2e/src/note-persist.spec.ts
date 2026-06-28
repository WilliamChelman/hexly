import { enterLibrary, expect, flushSave, test } from './fixtures';

/**
 * Full-stack note round-trip: real TipTap keyboard input → versioned save → reload
 * re-renders stored Content. Verifies the opaque snapshot via the API (ADR-0009/0019).
 */
test('types into a note, saves, and the Content survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-note').click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();

  // Click below the text (60% down) to prove the whole box focuses the editor, not just prose.
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

  // Confirm the snapshot was stored opaquely — format tag present, text inside.
  const res = await request.get(`/api/entities/${noteId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.type).toBe('note');
  expect(detail.document.content.format).toBe('tiptap-v2'); // mirrors CONTENT_FORMAT
  expect(JSON.stringify(detail.document.content.snapshot)).toContain(content);
});
