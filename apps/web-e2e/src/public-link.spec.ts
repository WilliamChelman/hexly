import { enterLibrary, expect, flushSave, openEntityActions, test } from './fixtures';

/**
 * Public Links (ADR-0037, #162): an Owner mints a per-entity Public Link from the Share
 * dialog, and a visitor with no account opens it to a strictly read-only rendering. This
 * drives the whole loop full-stack: author a note, mint the link, follow it in a fresh
 * (unauthenticated) browser context, see the content rendered read-only with no editing
 * chrome, then revoke it and watch the link go dead. The token-route authorization itself
 * (private-piercing, shared-only scope) is proven at the HTTP layer (supertests).
 */
test('an Owner mints a public link; an anonymous visitor reads it, then loses it on revoke', async ({
  page,
  browser,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
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

  // They see a read-only rendering through the REUSED editor (ADR-0037, #162): the banner,
  // the real note content — but genuinely read-only (the ProseMirror surface is
  // contenteditable=false) and with none of the edit chrome (no Share, no tag input).
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
