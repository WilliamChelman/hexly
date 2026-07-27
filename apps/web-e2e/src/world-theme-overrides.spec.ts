import type { Page } from '@playwright/test';
import { enterLibrary, expect, test } from './fixtures';
// The app's own pretty-URL codec (ADR-0042), imported by file path for the reason `fixtures.ts` gives.
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * A World Owner overrides an individual token (ADR-0076, #374).
 *
 * The unit tests own the folding — which tokens are offered, that clearing removes the key, that the
 * draft round-trips. What only a browser can answer is here: that an override beats the derivation the
 * anchors produced, that clearing hands the token back to it, and that re-anchoring the Palette moves
 * every token except the overridden one. The write choke point's refusals are asserted over HTTP,
 * because "not offered" and "rejected if sent" are two different claims.
 */

/** A custom property as it sits *inline* on `<html>` — empty when the applier has written none. */
function inlineOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => document.documentElement.style.getPropertyValue(token), name);
}

/** A custom property as the engine resolves it on the root, which is what actually renders. */
function resolvedOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
}

async function openThemeEditor(page: Page, worldSeg: string): Promise<void> {
  await page.goto(`/w/${worldSeg}/settings`);
  await page.getByTestId('settings-nav-theme').click();
  await expect(page.getByTestId('theme-scheme-solar')).toBeVisible();
}

/** Open one collapsed role family. ~50 rows is a wall, so the editor ships them closed (#374). */
async function openGroup(page: Page, group: string): Promise<void> {
  await page.getByTestId(`theme-override-group-${group}`).locator('summary').click();
}

/** Turn a derived row into an override and set it to `value`. */
async function override(page: Page, scheme: string, key: string, value: string): Promise<void> {
  await page.getByTestId(`theme-override-set-${scheme}-${key}`).click();
  await page.getByTestId(`theme-override-${scheme}-${key}`).fill(value);
}

async function saveTheme(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (r) => /\/api\/worlds\/[\w-]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
  );
  await page.getByTestId('theme-save').click();
  await saved;
}

/** The World's Theme as stored — the only witness to what a save actually persisted. */
async function storedTheme(page: Page, worldId: string) {
  const res = await page.request.get(`/api/worlds/${worldId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).theme;
}

test('an override beats the derivation, per ColorScheme, and clearing hands the token back to it', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'tones');

  const derived = await resolvedOnRoot(page, '--color-tone-1');
  expect(derived).toBeTruthy();

  // Opting out starts where the derivation left the token, for the ColorScheme the reader is in: the
  // automation is a starting point, so the click that departs from it moves nothing on its own.
  await page.getByTestId('theme-override-set-solar-color-tone-1').click();
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBeTruthy();
  expect(await resolvedOnRoot(page, '--color-tone-1')).toBe(derived);

  // Applied live: an inline custom property on the root beats both schemes' stylesheet rules, so an
  // override needs no machinery beyond being written last (ADR-0076).
  await page.getByTestId('theme-override-solar-color-tone-1').fill('#112233');
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBe('#112233');
  await expect.poll(() => resolvedOnRoot(page, '--color-tone-1')).not.toBe(derived);

  // Clearing removes the key rather than writing a value, so the derivation answers again. Asserted
  // before any save: the choke point rounds an anchor as it canonicalises it, so a derived value read
  // across a save differs in its last digits for reasons that have nothing to do with overriding.
  await page.getByTestId('theme-override-clear-solar-color-tone-1').click();
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBe('');
  await expect.poll(() => resolvedOnRoot(page, '--color-tone-1')).toBe(derived);

  // The other ColorScheme is a separate opt-out: authoring Astral's changes nothing a Solar reader sees.
  await override(page, 'solar', 'color-tone-1', '#112233');
  await override(page, 'astral', 'color-tone-1', '#445566');
  expect(await inlineOnRoot(page, '--color-tone-1')).toBe('#112233');

  await saveTheme(page);
  const stored = await storedTheme(page, worldId);
  // Canonicalised at the write choke point, and kept per ColorScheme.
  expect(stored.overrides.solar['--color-tone-1']).toMatch(/^oklch\(/);
  expect(stored.overrides.astral['--color-tone-1']).toMatch(/^oklch\(/);
  expect(stored.overrides.solar['--color-tone-1']).not.toBe(stored.overrides.astral['--color-tone-1']);

  // Persists and reloads: the editor reopens on the override, not on a derived row.
  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBe(stored.overrides.solar['--color-tone-1']);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'tones');
  await expect(page.getByTestId('theme-override-count-tones')).toBeVisible();

  // Cleared and saved: the key is gone, the other ColorScheme's is not, and the root carries nothing.
  await page.getByTestId('theme-override-clear-solar-color-tone-1').click();
  await saveTheme(page);
  const cleared = await storedTheme(page, worldId);
  expect(cleared.overrides.solar).toBeUndefined();
  expect(cleared.overrides.astral['--color-tone-1']).toBeTruthy();

  await page.reload();
  expect(await inlineOnRoot(page, '--color-tone-1')).toBe('');
});

test('re-anchoring the Palette moves every derived token and leaves the overridden one alone', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'tones');

  // The eight tones are hue rotations off the accent (ADR-0075), so one anchor moves all of them —
  // which is what makes this the sharpest witness that an override sits *after* the derivation.
  await override(page, 'solar', 'color-tone-1', '#112233');
  const overridden = await resolvedOnRoot(page, '--color-tone-1');
  const before = {
    accent: await resolvedOnRoot(page, '--color-accent'),
    tone2: await resolvedOnRoot(page, '--color-tone-2'),
    tone3: await resolvedOnRoot(page, '--color-tone-3'),
  };

  await page.getByTestId('theme-control-solar-accent').fill('#6a2ab0');

  await expect.poll(() => resolvedOnRoot(page, '--color-accent')).not.toBe(before.accent);
  await expect.poll(() => resolvedOnRoot(page, '--color-tone-2')).not.toBe(before.tone2);
  await expect.poll(() => resolvedOnRoot(page, '--color-tone-3')).not.toBe(before.tone3);
  // And the one the Owner opted out of does not follow the anchor it would otherwise derive from.
  expect(await resolvedOnRoot(page, '--color-tone-1')).toBe(overridden);
});

test('the editor offers only the public roles, and the choke point refuses the rest if sent', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  // Not offered: a private tier-1 anchor is authored as the Palette, and tier 3 belongs to its plugin.
  await expect(page.getByTestId('theme-override-set-solar-palette-accent')).toHaveCount(0);
  await expect(page.getByTestId('theme-override-set-solar-color-terrain-grass')).toHaveCount(0);
  await expect(page.getByTestId('theme-override-set-solar-color-canvas-edge')).toHaveCount(1);

  // Save a Theme so there is a well-formed one to bend one key of.
  await page.getByTestId('theme-control-solar-accent').fill('#6a2ab0');
  await saveTheme(page);
  const stored = await storedTheme(page, worldId);

  const send = (name: string, value: string) =>
    page.request.patch(`/api/worlds/${worldId}`, {
      data: { theme: { ...stored, overrides: { solar: { [name]: value } } } },
    });

  // Rejected if sent — "not offered" is a UI claim, and an Owner is untrusted input either way.
  expect((await send('--palette-accent', '#ffffff')).status()).toBe(400);
  expect((await send('--color-terrain-grass', '#ffffff')).status()).toBe(400);
  // And a value that is not of the token's declared type, which is the same refusal by another route.
  expect((await send('--color-tone-1', '6px')).status()).toBe(400);
  expect((await send('--shadow-2', 'url(https://evil.example/p.png)')).status()).toBe(400);

  // Refused, not sanitised into something that stores: the Theme is still the one that was saved.
  expect(await storedTheme(page, worldId)).toEqual(stored);
});
