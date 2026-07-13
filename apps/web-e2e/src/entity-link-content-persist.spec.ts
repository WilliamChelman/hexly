import { enterLibrary, entityIdFromUrl, expect, flushSave, segRe, test } from './fixtures';

/** The Content Entity Link journey (issue #95, ADR-0023). */
test('inserts a Content Entity Link via @, persists it, navigates it, and dangles when the target is gone', async ({
  page,
  request,
}) => {
  // Seed the link target: a note the picker can list and a click can jump to.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = entityIdFromUrl(page);

  // The source note that will carry the link in its prose.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const sourceId = entityIdFromUrl(page);
  // The source's full world-scoped path (ADR-0028) — reused to reopen it later.
  const sourcePath = new URL(page.url()).pathname;

  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Ruled by ');
  await page.keyboard.type('@');

  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await page.getByTestId(`entity-picker-option-${targetId}`).click();

  const link = page.getByTestId('entity-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('Untitled note');
  await expect(link).toHaveAttribute('data-entity-id', targetId!);
  // A real href so Ctrl/Cmd/middle-click open the target in a new tab natively.
  // The link is World-agnostic (#118): /entities/:id resolves the target's World
  // and redirects to /w/:worldId/entities/:id (asserted on the click below).
  await expect(link).toHaveAttribute('href', `/entities/${targetId}`);

  await flushSave(page);

  await page.reload();
  const res = await request.get(`/api/entities/${sourceId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.content.format).toBe('tiptap-v3');
  const snapshot = JSON.stringify(detail.document.content.snapshot);
  expect(snapshot).toContain('entityLink');
  expect(snapshot).toContain(targetId);

  await expect(page.getByTestId('entity-link')).toHaveText('Untitled note');
  await page.getByTestId('entity-link').click();
  await expect(page).toHaveURL(new RegExp(`/entities/${segRe(targetId)}$`));

  // Delete the target: the link now dangles (last-known label, non-navigable).
  const del = await request.delete(`/api/entities/${targetId}`);
  expect(del.ok()).toBeTruthy();

  await page.goto(sourcePath);
  const dangling = page.getByTestId('entity-link');
  await expect(dangling).toHaveAttribute('data-dangling', '');
  await expect(dangling).toHaveText('Untitled note');
});
