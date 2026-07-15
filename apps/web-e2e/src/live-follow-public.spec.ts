import { enterLibrary, expect, flushSave, openEntityActions, test } from './fixtures';

/**
 * An anonymous Public Link viewer is a first-class live-follow participant (ADR-0044): its
 * page updates on a GM edit without a reload, and evicts to the dead-link panel the moment
 * the Owner revokes the link.
 */
test('an anonymous Public Link viewer live-follows a GM edit, then evicts on revoke — no reload', async ({
  page,
  browser,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Author some Content so the public page has something to render, then persist it.
  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('The lighthouse keeper guards a secret.');
  await flushSave(page);

  // Mint the per-entity Public Link from the Share dialog and grab the shareable URL.
  await openEntityActions(page);
  await page.getByTestId('manage-owners').click();
  const minted = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/link$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('public-link-create').click();
  await minted;
  const url = await page.getByTestId('public-link-url').inputValue();
  // Close the Share dialog so its overlay stops intercepting the editor click below.
  await page.getByTestId('owners-close').click();

  // A visitor with NO account opens the link. An explicitly empty storageState overrides the
  // project's authenticated default (`storageState: authFile`) — a genuinely cookie-less context,
  // so the SSE stream opens on the token principal, not an inherited session.
  const anonContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const visitor = await anonContext.newPage();
  await visitor.goto(url);
  await expect(visitor.getByTestId('public-banner')).toBeVisible();
  await expect(visitor.getByTestId('note-content')).toContainText('secret');

  // The GM edits the Entity. The save nudges the anonymous follower, whose page refetches the
  // token surface (a real GET) and re-renders — arm the wait BEFORE the edit so we catch it.
  const followRefetch = visitor.waitForResponse(
    (r) => /\/api\/public\/entities\/[\w-]+$/.test(r.url()) && r.request().method() === 'GET' && r.ok(),
  );
  await surface.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' The tower burned at dawn.');
  await flushSave(page);

  // The visitor's page updated live — no reload was issued.
  await followRefetch;
  await expect(visitor.getByTestId('note-content')).toContainText('burned at dawn');

  // The Owner revokes the link: the anonymous follower is evicted to the dead-link panel on the
  // open screen (the `unavailable` nudge), again with no reload. Reopen the Share dialog (closed
  // above) to reach the revoke control.
  await openEntityActions(page);
  await page.getByTestId('manage-owners').click();
  const revoked = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/link$/.test(r.url()) && r.request().method() === 'DELETE' && r.ok(),
  );
  await page.getByTestId('public-link-revoke').click();
  await revoked;
  await expect(visitor.getByTestId('public-notfound')).toBeVisible();

  await anonContext.close();
});
