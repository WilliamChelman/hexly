import { enterLibrary, expect, flushSave, test } from './fixtures';

/**
 * The Content Entity Link journey (issue #95, ADR-0023): an author drops a live
 * link into prose via the `@` picker, and it survives a save + reload, renders the
 * target's live name, navigates on click, and falls back to a dangling label once
 * the target is deleted. Crosses every seam: real TipTap `@` suggestion, the
 * picker, a versioned save, an API read of the opaque snapshot (ADR-0009/0019),
 * SPA navigation, and the id→name resolver's live/missing states.
 * Prior art: entity-link-persist.spec.ts (the Map-element link).
 */
test('inserts a Content Entity Link via @, persists it, navigates it, and dangles when the target is gone', async ({
  page,
  request,
}) => {
  // Seed the link target: a note the picker can list and a click can jump to.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = page.url().split('/').pop();

  // The source note that will carry the link in its prose.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const sourceId = page.url().split('/').pop();
  // The source's full world-scoped path (ADR-0028) — reused to reopen it later.
  const sourcePath = new URL(page.url()).pathname;

  // Insert the link: type into the editor, trigger the `@` picker, pick the target.
  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Ruled by ');
  await page.keyboard.type('@');

  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await page.getByTestId(`entity-picker-option-${targetId}`).click();

  // The atom renders with the target's live name, pointing at its id.
  const link = page.getByTestId('entity-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('Untitled note');
  await expect(link).toHaveAttribute('data-entity-id', targetId!);
  // A real href so Ctrl/Cmd/middle-click open the target in a new tab natively —
  // scoped to the World in the URL (ADR-0028).
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`/w/[\\w-]+/entities/${targetId}$`),
  );

  await flushSave(page);

  // The persisted snapshot really carries the entityLink node, tagged tiptap-v2.
  await page.reload();
  const res = await request.get(`/api/entities/${sourceId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.content.format).toBe('tiptap-v2');
  const snapshot = JSON.stringify(detail.document.content.snapshot);
  expect(snapshot).toContain('entityLink');
  expect(snapshot).toContain(targetId);

  // After reload the link re-renders live and navigates to the target on click.
  await expect(page.getByTestId('entity-link')).toHaveText('Untitled note');
  await page.getByTestId('entity-link').click();
  await expect(page).toHaveURL(new RegExp(`/entities/${targetId}$`));

  // Delete the target: the link now dangles (last-known label, non-navigable).
  const del = await request.delete(`/api/entities/${targetId}`);
  expect(del.ok()).toBeTruthy();

  await page.goto(sourcePath);
  const dangling = page.getByTestId('entity-link');
  await expect(dangling).toHaveAttribute('data-dangling', '');
  await expect(dangling).toHaveText('Untitled note');
});
