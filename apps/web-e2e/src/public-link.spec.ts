import { enterEntities, expect, flushSave, openEntityActions, test } from './fixtures';

/**
 * Public Links (ADR-0037). Only the UI loop is covered here; the token-route authorization
 * (private-piercing, shared-only scope) is proven at the HTTP layer (supertests).
 */
test('an Owner mints a public link; an anonymous visitor reads it, then loses it on revoke', async ({
  page,
  browser,
}) => {
  await enterEntities(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Author some Content so the public page has something to render read-only.
  const content = 'The lighthouse keeper guards a secret.';
  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type(content);
  await flushSave(page);

  // Mint the per-entity Public Link from the Share dialog (via the actions menu).
  await openEntityActions(page);
  await page.getByTestId('manage-owners').click();
  const minted = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/link$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('public-link-create').click();
  await minted;
  const url = await page.getByTestId('public-link-url').inputValue();
  expect(url).toContain('/public/e/');

  // A visitor with NO account (a fresh context carries no session cookie) opens the link.
  const anonContext = await browser.newContext();
  const visitor = await anonContext.newPage();
  await visitor.goto(url);

  // The public page reuses the editor, so read-only means contenteditable=false plus no edit chrome.
  await expect(visitor.getByTestId('public-banner')).toBeVisible();
  await expect(visitor.getByTestId('note-content')).toContainText(content);
  await expect(visitor.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  // A read-only anonymous viewer gets no actions menu at all (no Share within it).
  await expect(visitor.getByTestId('entity-actions')).toHaveCount(0);
  await expect(visitor.getByTestId('tag-input')).toHaveCount(0);

  // Revoking is the kill-switch: the link stops resolving immediately.
  const revoked = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/link$/.test(r.url()) && r.request().method() === 'DELETE' && r.ok(),
  );
  await page.getByTestId('public-link-revoke').click();
  await revoked;

  await visitor.reload();
  await expect(visitor.getByTestId('public-notfound')).toBeVisible();

  await anonContext.close();
});
