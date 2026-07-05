import { enterLibrary, expect, test } from './fixtures';
import { TEST_GRANTEE } from './test-user';

/**
 * Entity-level grants (ADR-0037, #161): an Owner shares one Entity with a named Instance
 * user — Editor or Viewer — from the Share dialog, even someone who isn't in the World.
 * This drives the whole surface: open Share, pick a person + role, see the grant land,
 * then revoke it. The grantee's read access is proven at the HTTP layer (supertests);
 * here we assert the Owner-facing UI round-trips through the real API.
 */
test('an Owner shares an Entity with a named user, then revokes it', async ({ page }) => {
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Open the Share dialog and share this note with Gwen as a Viewer.
  await page.getByTestId('manage-owners').click();
  await expect(page.getByText('Not shared with anyone yet.')).toBeVisible();

  await page.getByTestId('grant-add-select').selectOption({ label: TEST_GRANTEE.displayName });
  await page.getByTestId('grant-add-role').selectOption('viewer');
  const granted = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/grants$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('grant-add').click();
  await granted;

  // The grantee now shows as a Viewer row.
  const row = page.locator('.grant-row', { hasText: TEST_GRANTEE.displayName });
  await expect(row).toBeVisible();
  await expect(row.locator('select')).toHaveValue('viewer');

  // Revoke it — the row disappears and the empty state returns.
  const revoked = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/grants\//.test(r.url()) && r.request().method() === 'DELETE' && r.ok(),
  );
  await row.getByRole('button', { name: /Revoke/i }).click();
  await revoked;
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Not shared with anyone yet.')).toBeVisible();
});
