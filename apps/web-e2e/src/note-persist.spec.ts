import { expect, test } from './fixtures';

/**
 * The note counterpart to paint-persist: it crosses every seam for a `note` Entity
 * — the session cookie on API calls, real TipTap keyboard input, a versioned save,
 * and a reload that re-renders the stored Content. The Content snapshot is opaque
 * (ADR-0019), so we prove the round trip by reloading and by reading the persisted
 * document back through the API (ADR-0009).
 */
test('types into a note, saves, and the prose survives a reload', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-note').click();

  // Creating a note opens the note view at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();

  // Type real prose into the editor — TipTap turns the keystrokes into a
  // ProseMirror document the view streams into the session's live Content.
  // Click low in the container — the empty area below the prose, not a text line —
  // to prove the whole box focuses the editor, not just the rendered text.
  const surface = page.getByTestId('note-content');
  const prose = 'Lady Mara rules the northern reach.';
  const box = await surface.boundingBox();
  await surface.click({ position: { x: 60, y: (box?.height ?? 200) * 0.6 } });
  await page.keyboard.type(prose);
  await expect(surface).toContainText(prose);

  // Wait on the real save round-trip (not just the button text) so the reload
  // below can't race an in-flight PUT.
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.getByTestId('save').click();
  await saved;
  await expect(page.getByTestId('save')).toHaveText('Save');

  // The seam under test: a fresh load re-fetches and re-renders the saved note.
  await page.reload();
  await expect(page.getByTestId('note-content')).toContainText(prose);
  await expect(page.getByTestId('note-title')).toHaveText('Untitled note');

  // And the persisted document really carries that prose, under the format tag —
  // the domain stored the snapshot opaquely without reshaping it.
  const res = await request.get(`/api/entities/${noteId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.type).toBe('note');
  expect(detail.document.content.format).toBe('tiptap-v1');
  expect(JSON.stringify(detail.document.content.snapshot)).toContain(prose);
});
