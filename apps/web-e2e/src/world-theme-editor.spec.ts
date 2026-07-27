import type { Page } from '@playwright/test';
import { designToken, rasteriseColors } from '@hexly/web-styles';
import { PALETTE_TOKENS } from '@hexly/domain';
import { enterLibrary, expect, signInGrantee, test } from './fixtures';
import { TEST_GRANTEE } from './test-user';
// The app's own pretty-URL codec (ADR-0042), imported by file path for the reason `fixtures.ts` gives.
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * A World Owner authors their Palette and watches it apply (ADR-0076, #371).
 *
 * The unit tests own the mapping — draft to layer, reset, which control a declared type picks, and what
 * a set of measured colours is worth (`contrast.spec.ts`). What only a browser can answer is here: that
 * moving a control re-themes the running interface, that both ColorSchemes are authorable and *reported
 * on* from one seat, and that a Contributor never reaches the editor at all.
 */

/**
 * Every authorable value, named as the stored Theme names it and typed as the manifest declares it —
 * both ends off their own source, so nothing here is a list this spec keeps in step by hand.
 */
const PALETTE_FIELDS = Object.entries(PALETTE_TOKENS).map(([field, token]) => ({
  field,
  type: designToken(token).type,
}));

/** A custom property as it sits *inline* on `<html>` — empty when the applier has written none. */
function inlineOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => document.documentElement.style.getPropertyValue(token), name);
}

/** A custom property as the engine resolves it on the root, which is what actually renders. */
function resolvedOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
}

/** Open the Theme editor from World settings. */
async function openThemeEditor(page: Page, worldSeg: string): Promise<void> {
  await page.goto(`/w/${worldSeg}/settings`);
  await page.getByTestId('settings-nav-theme').click();
  await expect(page.getByTestId('theme-scheme-solar')).toBeVisible();
}

/** Save the draft and wait for the World the choke point canonicalised it onto. */
async function saveTheme(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (r) => /\/api\/worlds\/[\w-]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
  );
  await page.getByTestId('theme-save').click();
  await saved;
}

/**
 * Hand the World back its unthemed self: reset stages the Hexly default and saving is what commits it.
 * The suite's reset keeps Worlds, so a Theme authored here outlives the spec that wrote it — and a
 * deliberately illegible one would go on to paint every spec that runs after.
 */
async function restoreDefaultTheme(page: Page): Promise<void> {
  await page.getByTestId('theme-reset').click();
  await saveTheme(page);
}

/** How light a resolved colour is, 0..765 — enough to tell a near-black foreground from a near-white. */
async function brightnessOnRoot(page: Page, name: string): Promise<number> {
  const [rgb] = await page.evaluate(rasteriseColors, [await resolvedOnRoot(page, name)]);
  return rgb[0] + rgb[1] + rgb[2];
}

/** The World's Theme as stored — the only witness to what a save actually persisted. */
async function storedTheme(page: Page, worldId: string) {
  const res = await page.request.get(`/api/worlds/${worldId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).theme;
}

test('the editor renders a control per declared tier-1 token, for both ColorSchemes at once', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  await openThemeEditor(page, worldSeg);

  // Every anchor and knob the manifest declares is authorable, in *both* halves, from one seat: a
  // Theme and a reader's ColorScheme are orthogonal (ADR-0006), and an Owner who can only reach the
  // scheme they are sitting in ships half a Theme. Nothing here names a control the manifest doesn't.
  for (const { field, type } of PALETTE_FIELDS) {
    for (const scheme of ['solar', 'astral']) {
      const control = page.getByTestId(`theme-control-${scheme}-${field}`);
      await expect(control, `${scheme} ${field}`).toBeVisible();
      // The control comes from the declared *type*: a colour gets a colour well, a knob a slider.
      await expect(control).toHaveAttribute('type', type === 'color' ? 'color' : 'range');
    }
  }

  await expect(page.getByTestId('theme-scheme-astral')).toBeVisible();
});

test('editing a value re-themes the interface immediately, and saving it survives a reload', async ({ page }) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  const beforeAccent = await resolvedOnRoot(page, '--color-accent');

  // Not saved, not reloaded — the control moves and the document is repainted from it.
  await page.getByTestId('theme-control-solar-accent').fill('#6a2ab0');

  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#6a2ab0');
  // Tier 2 derives from tier 1 (ADR-0075), so one anchor re-themes every role above it.
  await expect.poll(() => resolvedOnRoot(page, '--color-accent')).not.toBe(beforeAccent);
  // A draft is not the World's Theme: nothing is stored until it is saved.
  expect(await storedTheme(page, worldId)).toBeFalsy();

  // Both halves in one sitting — the astral anchor is authored without toggling the reader's own scheme.
  await page.getByTestId('theme-control-astral-accent').fill('#33cc88');
  await page.getByTestId('theme-control-solar-veil').fill('0.4');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'solar');

  await saveTheme(page);

  const stored = await storedTheme(page, worldId);
  // Canonicalised at the write choke point (ADR-0076) — the notation the control sent stops mattering.
  expect(stored.solar.accent).toMatch(/^oklch\(/);
  expect(stored.astral.accent).toMatch(/^oklch\(/);
  expect(stored.solar.veil).toBe(0.4);

  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(stored.solar.accent);
  // And the editor reopens on what stored, not on the Hexly default.
  await openThemeEditor(page, worldSeg);
  await expect(page.getByTestId('theme-control-solar-veil')).toHaveValue('0.4');
});

test('cancelling puts the saved Theme back, and reset then saved returns the World to the Hexly default', async ({
  page,
}) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  await page.getByTestId('theme-control-solar-accent').fill('#6a2ab0');
  await saveTheme(page);
  const saved = await storedTheme(page, worldId);

  // A failed experiment costs nothing: cancel drops the draft and the saved Theme paints again.
  await page.getByTestId('theme-control-solar-accent').fill('#118844');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#118844');
  await page.getByTestId('theme-discard').click();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(saved.solar.accent);

  // Reset stages the Hexly default — it previews at once, and saving is what returns the World to it.
  await page.getByTestId('theme-reset').click();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('');
  await expect(page.getByTestId('theme-unsaved')).toBeVisible();

  await saveTheme(page);
  // Cleared, not emptied: the World carries no Theme at all, so the read leaves the field out.
  expect(await storedTheme(page, worldId)).toBeUndefined();

  await page.reload();
  expect(await inlineOnRoot(page, '--palette-accent')).toBe('');
});

test('a Theme edit changes nothing about what Entities contain or who can read them', async ({ page, request }) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  const before = await (await request.get(`/api/worlds/${worldId}/graph`)).json();

  await openThemeEditor(page, worldSeg);
  await page.getByTestId('theme-control-solar-accent').fill('#6a2ab0');
  await saveTheme(page);

  const after = await (await request.get(`/api/worlds/${worldId}/graph`)).json();
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
});

test('a Contributor does not reach the Theme editor', async ({ page, request, browser }) => {
  const worldSeg = await enterLibrary(page);
  // Over the API rather than the Access pane: the reset keeps Worlds *and* their members, so by the
  // time this spec runs the second user may already hold a role here — and the add picker, which
  // offers only non-members, would then have nothing to select. The POST is an upsert either way.
  const directory: { id: string; displayName: string }[] = await (await request.get('/api/users/directory')).json();
  const grantee = directory.find((user) => user.displayName === TEST_GRANTEE.displayName);
  expect(grantee, 'the second seeded user is in the Instance directory').toBeTruthy();
  const added = await request.post(`/api/worlds/${idFromSegment(worldSeg)}/members`, {
    data: { userId: grantee!.id, role: 'contributor' },
  });
  expect(added.ok(), await added.text()).toBeTruthy();

  const contributor = await signInGrantee(browser);
  await contributor.goto(`/w/${worldSeg}/settings`);

  // The Settings shell renders for any reader, so anchor on a section that is *there* first — an
  // absence asserted before the rail renders is an absence of everything, and proves nothing.
  await expect(contributor.getByTestId('settings-nav-schema')).toBeVisible();

  // Authoring identity is a manage right (ADR-0039); a Contributor writes Entities, not the World.
  await expect(contributor.getByTestId('settings-nav-theme')).toHaveCount(0);
  await expect(contributor.getByTestId('theme-save')).toHaveCount(0);

  await contributor.context().close();
});

test('the readability report covers the ColorScheme the author is not looking at, and a failing Theme still saves', async ({
  page,
}) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'solar');
  await expect(page.locator('[data-testid^="theme-warning-astral"]')).toHaveCount(0);

  // Astral ink a shade off the Astral page — illegible, in the half of the Theme nobody is looking at.
  await page.getByTestId('theme-control-astral-ink').fill('#12142a');

  const astral = page.getByTestId('theme-warning-astral-contrast-ink-bg');
  await expect(astral).toBeVisible();
  // The ratio is shown, so an Owner judges rather than guesses (ADR-0076).
  await expect(astral).toHaveText(/\d+\.\d\d:1/);
  await expect(page.getByTestId('theme-warning-astral-contrast-ink-surface')).toBeVisible();
  // The reader is in Solar and Solar's ink has not moved, so the warning cannot be the active Palette's
  // wearing the other one's name. That is the assertion the whole feature turns on.
  await expect(page.getByTestId('theme-warning-solar-contrast-ink-bg')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'solar');

  // And the mirror image: put Astral back, break Solar, and the two reports swap over.
  await page.getByTestId('theme-control-astral-ink').fill('#ece3cf');
  await page.getByTestId('theme-control-solar-ink').fill('#efe4c8');
  await expect(page.getByTestId('theme-warning-solar-contrast-ink-bg')).toBeVisible();
  await expect(page.getByTestId('theme-warning-astral-contrast-ink-bg')).toHaveCount(0);

  // Warn, never block: a deliberately oppressive Palette in a horror World is a legitimate choice, and
  // a block just gets routed around by overriding a different token (ADR-0076).
  await saveTheme(page);
  expect(await storedTheme(page, worldId)).toBeTruthy();

  await restoreDefaultTheme(page);
});

test('a mid-tone accent and a tone rotated into a status colour each get their own warning, and on-colours flip unasked', async ({
  page,
}) => {
  const worldSeg = await enterLibrary(page);
  await openThemeEditor(page, worldSeg);

  // `contrast-color()` answers black or white and nothing between, so a mid-tone accent is one no
  // automatic foreground rescues — CSS cannot resolve it, and only reading it back makes it visible.
  await page.getByTestId('theme-control-solar-accent').fill('#bb00ff');
  await expect(page.getByTestId('theme-warning-solar-midtone')).toBeVisible();

  // Re-anchoring the accent rotates all eight categorical tones with it, so the exclusion arc computed
  // against Hexly's accent stops holding for theirs: at this hue, tone 3 lands on danger (ADR-0075).
  await page.getByTestId('theme-control-solar-accent').fill('#0099cc');
  await expect(page.getByTestId('theme-warning-solar-midtone')).toHaveCount(0);
  await expect(page.getByTestId('theme-warning-solar-tone-3-danger')).toBeVisible();

  // On-colours flip silently and with no control of their own: the Owner moved the accent, and the
  // foreground that sits on it went the other way (ADR-0076).
  await expect(page.getByTestId('theme-control-solar-onFill')).toHaveCount(0);
  await page.getByTestId('theme-control-solar-accent').fill('#f5e6b0');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#f5e6b0');
  expect(await brightnessOnRoot(page, '--color-on-fill')).toBeLessThan(200);

  await page.getByTestId('theme-control-solar-accent').fill('#241a05');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#241a05');
  expect(await brightnessOnRoot(page, '--color-on-fill')).toBeGreaterThan(600);
  // Nothing is saved here, so nothing needs handing back: leaving the editor is a cancel (#371).
});
