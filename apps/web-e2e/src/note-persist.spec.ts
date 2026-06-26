import { expect, test, waitForSave } from './fixtures';

/**
 * The note counterpart to paint-persist: it crosses every seam for a `note` Entity
 * — the session cookie on API calls, real TipTap keyboard input, a versioned save,
 * and a reload that re-renders the stored Content. The Content snapshot is opaque
 * (ADR-0019), so we prove the round trip by reloading and by reading the persisted
 * document back through the API (ADR-0009).
 */
test('types into a note, saves, and the Content survives a reload', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-note').click();

  // Creating a note opens the note view at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();

  // Type real Content into the editor — TipTap turns the keystrokes into a
  // ProseMirror document the view streams into the session's live Content.
  // Click low in the container — the empty area below the text, not a text line —
  // to prove the whole box focuses the editor, not just the rendered text.
  const surface = page.getByTestId('note-content');
  const content = 'Lady Mara rules the northern reach.';
  const box = await surface.boundingBox();
  await surface.click({ position: { x: 60, y: (box?.height ?? 200) * 0.6 } });
  await page.keyboard.type(content);
  await expect(surface).toContainText(content);

  // Wait on the real save round-trip (not just the button text) so the reload
  // below can't race an in-flight PUT.
  const saved = waitForSave(page);
  await page.getByTestId('save').click();
  await saved;
  await expect(page.getByTestId('save')).toHaveText('Save');

  // The seam under test: a fresh load re-fetches and re-renders the saved note.
  await page.reload();
  await expect(page.getByTestId('note-content')).toContainText(content);
  await expect(page.getByTestId('note-title')).toHaveText('Untitled note');

  // The persisted document carries the Content under the format tag — the domain
  // stored the snapshot opaquely without reshaping it.
  const res = await request.get(`/api/entities/${noteId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.type).toBe('note');
  expect(detail.document.content.format).toBe('tiptap-v1'); // mirrors CONTENT_FORMAT
  expect(JSON.stringify(detail.document.content.snapshot)).toContain(content);
});
