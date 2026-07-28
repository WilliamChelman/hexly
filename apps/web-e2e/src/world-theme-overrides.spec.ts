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
  await expect(page.getByTestId('theme-scheme-light')).toBeVisible();
}

/** Open one collapsed role family. ~50 rows is a wall, so the editor ships them closed (#374). */
async function openGroup(page: Page, group: string): Promise<void> {
  await page.getByTestId(`theme-override-group-${group}`).locator('summary').click();
}

/** Turn an untouched row into an override and set it to `value`. */
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
  await page.getByTestId('theme-override-set-light-color-tone-1').click();
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBeTruthy();
  expect(await resolvedOnRoot(page, '--color-tone-1')).toBe(derived);

  // Applied live: an inline custom property on the root beats both schemes' stylesheet rules, so an
  // override needs no machinery beyond being written last (ADR-0076).
  await page.getByTestId('theme-override-light-color-tone-1').fill('#112233');
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBe('#112233');
  await expect.poll(() => resolvedOnRoot(page, '--color-tone-1')).not.toBe(derived);

  // Clearing removes the key rather than writing a value, so the derivation answers again. Asserted
  // before any save: the choke point rounds an anchor as it canonicalises it, so a derived value read
  // across a save differs in its last digits for reasons that have nothing to do with overriding.
  await page.getByTestId('theme-override-clear-light-color-tone-1').click();
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBe('');
  await expect.poll(() => resolvedOnRoot(page, '--color-tone-1')).toBe(derived);

  // The other ColorScheme is a separate opt-out: authoring the dark one's changes nothing a light reader sees.
  await override(page, 'light', 'color-tone-1', '#112233');
  await override(page, 'dark', 'color-tone-1', '#445566');
  expect(await inlineOnRoot(page, '--color-tone-1')).toBe('#112233');

  await saveTheme(page);
  const stored = await storedTheme(page, worldId);
  // Canonicalised at the write choke point, and kept per ColorScheme.
  expect(stored.overrides.light['--color-tone-1']).toMatch(/^oklch\(/);
  expect(stored.overrides.dark['--color-tone-1']).toMatch(/^oklch\(/);
  expect(stored.overrides.light['--color-tone-1']).not.toBe(stored.overrides.dark['--color-tone-1']);

  // Persists and reloads: the editor reopens on the override, not on a derived row.
  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--color-tone-1')).toBe(stored.overrides.light['--color-tone-1']);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'tones');
  await expect(page.getByTestId('theme-override-count-tones')).toBeVisible();

  // Cleared and saved: the key is gone, the other ColorScheme's is not, and the root carries nothing.
  await page.getByTestId('theme-override-clear-light-color-tone-1').click();
  await saveTheme(page);
  const cleared = await storedTheme(page, worldId);
  expect(cleared.overrides.light).toBeUndefined();
  expect(cleared.overrides.dark['--color-tone-1']).toBeTruthy();

  await page.reload();
  expect(await inlineOnRoot(page, '--color-tone-1')).toBe('');
});

test('an untouched row shows the value its own ColorScheme renders, not a word for where it came from', async ({
  page,
}) => {
  const worldSeg = await enterLibrary(page);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'tones');

  const light = page.getByTestId('theme-override-set-light-color-tone-5');
  const dark = page.getByTestId('theme-override-set-dark-color-tone-5');

  // The cell carries the value; where it came from is the row's mark, one column over. The two used to
  // be one word, and that word was wrong wherever the value was not an expression over the anchors.
  await expect(light).toHaveText(/^#[0-9a-f]{6}$/i);
  await expect(dark).toHaveText(/^#[0-9a-f]{6}$/i);

  // And each column is measured under *its own* Palette. On an unedited World, the light scheme's roles resolve
  // to exactly what the manifest declares (`manifest.spec.ts`) — so a fallback to the manifest for the
  // ColorScheme the reader is not in would put the same value in both cells. It does not.
  const shown = { light: await light.innerText(), dark: await dark.innerText() };
  expect(shown.dark).not.toBe(shown.light);

  // And each is what its own opt-out starts at, so the click that departs from the derivation moves
  // nothing — in the ColorScheme the reader is not in as much as in the one they are.
  await light.click();
  await dark.click();
  await expect(page.getByTestId('theme-override-light-color-tone-5')).toHaveValue(shown.light);
  await expect(page.getByTestId('theme-override-dark-color-tone-5')).toHaveValue(shown.dark);
});

/**
 * The mark on an untouched row, and the two things it rests on. Only a browser can answer either: the
 * derivations are read from the CSSOM, and jsdom loads no stylesheet at all.
 */
test('marks each untouched row with where its value comes from, off the stylesheet that declares it', async ({
  page,
}) => {
  const worldSeg = await enterLibrary(page);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'surfaces');
  await openGroup(page, 'canvas');

  // An expression over tier 1, an anchor under another name, and a value stated outright — the three
  // the old blanket "derived" collapsed into one, and got wrong for eight of the fifty-one rows.
  await expect(page.getByTestId('theme-derivation-color-surface-raised')).toHaveText('Derived');
  await expect(page.getByTestId('theme-derivation-color-bg')).toHaveText('Anchor');
  await expect(page.getByTestId('theme-derivation-color-canvas-glow')).toHaveText('Fixed');

  // And the formula is the declaration itself, not a description of it.
  await expect(page.locator('[data-testid="theme-derivation-color-bg"] ~ code')).toHaveText('--palette-page');
  await expect(page.locator('[data-testid="theme-derivation-color-surface-raised"] ~ code')).toHaveAttribute(
    'title',
    /^oklch\(from var\(--palette-page\)/,
  );

  const marks = await page.locator('[data-testid^="theme-derivation-"]').allInnerTexts();
  expect(marks, 'every offered row is marked — a row the CSSOM read missed would carry none').toHaveLength(51);
});

/**
 * What the row mark assumes: a tier-2 role is one expression for both ColorSchemes (ADR-0075), so it
 * can be read once. A ColorScheme that reassigns a public role therefore states a literal — the mark is
 * read as light, and this is what says that reading answers for dark too.
 */
test('declares every public role once, so a ColorScheme only ever restates a literal', async ({ page }) => {
  await enterLibrary(page);

  const reassigned = await page.evaluate(() => {
    const found: { name: string; value: string }[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        // Tailwind lowers each `@property` into a `@supports` block that restates the resolved value.
        if (rule instanceof CSSSupportsRule) continue;
        // A scheme's *own* block. Since ADR-0077 every Palette is declared at the root, so naming a
        // ColorScheme — never `:root` alone — is what makes a rule one scheme's rather than both's.
        const selector = rule instanceof CSSStyleRule ? rule.selectorText : '';
        if (rule instanceof CSSStyleRule && /\[data-color-scheme=/.test(selector)) {
          for (const name of Array.from(rule.style)) {
            if (/^--(color|shadow)-/.test(name)) {
              found.push({ name, value: rule.style.getPropertyValue(name).trim() });
            }
          }
        }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) walk(nested);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* a cross-origin sheet declares none of ours */
      }
    }
    return found;
  });

  // What a scheme states alone is a named literal — the two ColorSchemes' field glows are two design
  // ideas, not one parameterised one — and nothing in it may reach for an anchor.
  expect(reassigned, 'the dark block declares at least the one named literal').not.toHaveLength(0);
  const computed = reassigned.filter(({ value }) =>
    /var\(--palette-|oklch\(\s*from|color-mix\(|contrast-color\(/.test(value),
  );
  expect(computed.map(({ name }) => name)).toEqual([]);
});

test('re-anchoring the Palette moves every derived token and leaves the overridden one alone', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  await openThemeEditor(page, worldSeg);
  await openGroup(page, 'tones');

  // The eight tones are hue rotations off the accent (ADR-0075), so one anchor moves all of them —
  // which is what makes this the sharpest witness that an override sits *after* the derivation.
  await override(page, 'light', 'color-tone-1', '#112233');
  const overridden = await resolvedOnRoot(page, '--color-tone-1');
  const before = {
    accent: await resolvedOnRoot(page, '--color-accent'),
    tone2: await resolvedOnRoot(page, '--color-tone-2'),
    tone3: await resolvedOnRoot(page, '--color-tone-3'),
  };

  await page.getByTestId('theme-control-light-accent').fill('#6a2ab0');

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
  await expect(page.getByTestId('theme-override-set-light-palette-accent')).toHaveCount(0);
  await expect(page.getByTestId('theme-override-set-light-color-terrain-grass')).toHaveCount(0);
  await expect(page.getByTestId('theme-override-set-light-color-canvas-edge')).toHaveCount(1);

  // Save a Theme so there is a well-formed one to bend one key of.
  await page.getByTestId('theme-control-light-accent').fill('#6a2ab0');
  await saveTheme(page);
  const stored = await storedTheme(page, worldId);

  const send = (name: string, value: string) =>
    page.request.patch(`/api/worlds/${worldId}`, {
      data: { theme: { ...stored, overrides: { light: { [name]: value } } } },
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
