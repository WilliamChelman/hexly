import { expect, test, type Page } from './fixtures';

/**
 * User Settings (ADR-0038): the Format Locale chosen on `/settings` persists on
 * the account (rides `/auth/me`) and reformats displayed dates — the entity
 * browser's "Edited" date — without touching the UI language. The test restores
 * "Same as language" at the end: preferences roam on the shared e2e user and
 * survive the entities-only reset.
 */

/** Pick a Format Locale on /settings and wait for the roaming PATCH to land. */
async function chooseFormatLocale(page: Page, tag: string): Promise<void> {
  const patched = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/auth/me/preferences') &&
      r.request().method() === 'PATCH' &&
      r.ok(),
  );
  await page.getByTestId('format-locale').selectOption(tag);
  await patched;
}

test('Format Locale roams via the account and reflows the entity browser date', async ({
  page,
}) => {
  // A fresh World is empty (ADR-0043), so seed one note to give the browser a card
  // with an "Edited" date.
  await page.goto('/');
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/worlds') &&
      r.request().method() === 'POST' &&
      r.ok(),
  );
  await page.getByTestId('create-world').click();
  const world = await (await created).json();
  await page.goto(`/w/${world.id}/entities`);
  await page.getByTestId('new-note').click();
  await page.waitForURL(new RegExp(`/w/[\\w-]+/entities/[\\w-]+$`));

  await page.goto('/settings');
  await expect(page.getByTestId('email')).not.toBeEmpty();
  try {
    await chooseFormatLocale(page, 'en-GB');

    // The choice roams: the auth payload itself now carries it.
    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.preferences.formatLocale).toBe('en-GB');

    // The browser's "Edited" date reads day-first while the copy stays English.
    await page.goto(`/w/${world.id}/entities`);
    const gbToday = new Intl.DateTimeFormat('en-GB').format(new Date());
    await expect(page.getByText(`Edited ${gbToday}`).first()).toBeVisible();
  } finally {
    // "Same as language" again, so the shared user leaks nothing to other tests.
    await page.goto('/settings');
    await chooseFormatLocale(page, '');
  }
});
