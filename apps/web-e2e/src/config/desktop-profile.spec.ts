import { enterLibrary, expect, openEntityActions, test } from '../fixtures';

/**
 * The `desktop` Deployment Profile end-to-end via its own server, whose profile the boot script pins
 * — there is no hexly.yml key for it (ADR-0071; server in `playwright.config.ts`). The run
 * authenticates by posting to the login endpoint (`desktop-auth.setup.ts`), since this profile has no
 * login page, and its config has Collaboration off as the Desktop App pins it, so both cut lists are
 * covered here rather than in Electron.
 *
 * The account is Sole-User-shaped — Superadmin holding every Instance Role — so no absence below can
 * be an Instance Role check's doing (ADR-0071).
 */

test('the desktop profile has no login page and no route to one', async ({ page, request }) => {
  const res = await request.get('/api/config');
  expect(res.ok()).toBeTruthy();
  const config = await res.json();
  // Two independent knobs (ADR-0071); the Desktop App pins both, so this run does too.
  expect(config.profile).toBe('desktop');
  expect(config.collaboration).toBe(false);

  // The stored session was minted over the API, never typed: the World Index opens on it.
  await page.goto('/worlds');
  await expect(page).toHaveTitle(/Worlds/);

  // Typed in directly, /login is no destination: it bounces to the World Index and the form the
  // Sole User could not fill in anyway never renders.
  await page.goto('/login');
  await expect(page).toHaveURL(/\/worlds$/);
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
});

test('the user menu keeps theme and language and drops the session and the identity', async ({ page }) => {
  await page.goto('/worlds');

  // Located by component, not by accessible name: the name is translated, and this spec flips the
  // language below to prove that row still works.
  const trigger = page.locator('app-user-menu button');
  await trigger.click();
  const menu = page.getByRole('menu');

  // No session to manage: neither Sign out nor its signed-out counterpart.
  await expect(menu.getByRole('menuitem', { name: /sign out/i })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /login/i })).toHaveCount(0);
  // A non-identity trigger (ADR-0071): no initials, and no display name in the trigger or the panel.
  await expect(page.getByTestId('user-initials')).toHaveCount(0);
  await expect(trigger).not.toContainText('E2E Tester');
  await expect(menu).not.toContainText('E2E Tester');

  // Theme and language are account-independent preferences and stay, working.
  const theme = await page.locator('html').getAttribute('data-theme');
  await menu.getByRole('menuitem', { name: /switch to (solar|astral) theme/i }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', String(theme));

  await trigger.click();
  const languages = page.getByRole('menu').getByRole('menuitemradio');
  await expect(languages).toHaveCount(2);
  await expect(languages.filter({ hasText: 'English' })).toHaveAttribute('aria-checked', 'true');
  await languages.filter({ hasText: 'Français' }).click();

  await trigger.click();
  await expect(page.getByRole('menu').getByRole('menuitemradio', { name: /français/i })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('Settings keeps its Preferences and offers no Profile section and no password form', async ({ page }) => {
  await page.goto('/settings');

  for (const testid of ['theme-light', 'theme-dark', 'language', 'format-locale']) {
    await expect(page.getByTestId(testid)).toBeVisible();
  }
  // There is no account to manage, because there is no password anywhere (ADR-0070).
  for (const testid of [
    'email',
    'display-name',
    'save-profile',
    'current-password',
    'new-password',
    'change-password',
  ]) {
    await expect(page.getByTestId(testid)).toHaveCount(0);
  }
});

test('a session that cannot be recovered ends on an unrecoverable error, not the login page', async ({ page }) => {
  // Only the policy half: re-minting is a capability question the preload bridge answers, and a
  // browser has no bridge (ADR-0070, ADR-0071).
  await page.context().clearCookies();
  await page.goto('/worlds');

  await expect(page).toHaveURL(/\/session-error$/);
  await expect(page.getByTestId('session-error')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveCount(0);

  // Every other guarded destination agrees, and none of them offers a returnUrl to come back with.
  for (const url of ['/settings', '/admin', '/w/nope']) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/session-error$/);
  }
});

test('the Collaboration cut list is hidden here too, as the Desktop App pins it off', async ({ page }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await openEntityActions(page);
  await expect(page.getByTestId('edit-types')).toBeVisible();
  await expect(page.getByTestId('manage-owners')).toHaveCount(0);
  await expect(page.getByTestId('visibility-toggle')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('app-owner-set')).toHaveCount(0);
  await expect(page.locator('app-grant-set')).toHaveCount(0);
  await expect(page.locator('app-public-link')).toHaveCount(0);

  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page.getByTestId('facet-heading-visibility')).toHaveCount(0);

  await page.goto('/worlds');
  await expect(page.getByTestId('nav-admin')).toBeVisible();
  await expect(page.getByTestId('nav-users')).toHaveCount(0);

  // The Palette entry ADR-0071 names as the trap: this account holds manage-users and Superadmin.
  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByTestId('command-palette-input').fill('>go');
  await expect(page.getByTestId('command-palette-option-go-admin')).toBeVisible();
  await expect(page.getByTestId('command-palette-option-go-users')).toHaveCount(0);

  // And the one affordance this profile does *not* get by being this profile: moving the Asset storage needs a
  // native picker and a `hexly.yml` to rewrite, so it checks for the preload bridge, which a browser has not
  // got (#326, ADR-0071). Absent here, and absent for the right reason.
  await page.getByTestId('command-palette-input').fill('>asset');
  await expect(page.getByTestId('command-palette-option-move-asset-storage')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/users');
  await expect(page).toHaveURL(/\/worlds$/);
});
