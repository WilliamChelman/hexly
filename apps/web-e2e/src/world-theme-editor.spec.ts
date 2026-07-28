import type { APIRequestContext, Page } from '@playwright/test';
import { designToken, rasteriseColors } from '@hexly/web-styles';
import { FONT_PAIRINGS, PALETTE_PRESETS, PALETTE_TOKENS, WorldThemeSchemeKey, colorTokenHex } from '@hexly/domain';
import { enterEntities, expect, signInGrantee, test } from './fixtures';
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
  await expect(page.getByTestId('theme-scheme-light')).toBeVisible();
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
  const [rgb] = await page.evaluate(rasteriseColors, { values: [await resolvedOnRoot(page, name)] });
  return rgb[0] + rgb[1] + rgb[2];
}

/** The World's Theme as stored — the only witness to what a save actually persisted. */
async function storedTheme(page: Page, worldId: string) {
  const res = await page.request.get(`/api/worlds/${worldId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).theme;
}

/** Clear a World's Theme, so a themed World does not outlive the test that themed it. */
async function clearTheme(request: APIRequestContext, worldId: string): Promise<void> {
  expect((await request.patch(`/api/worlds/${worldId}`, { data: { theme: null } })).ok()).toBeTruthy();
}

/** What the engine resolves `property` to on the first element matching `selector` — what renders. */
function computedOn(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel);
      return element ? getComputedStyle(element).getPropertyValue(prop).trim() : '';
    },
    [selector, property] as const,
  );
}

/** The five values the radius ladder currently renders as, read off the root in manifest order. */
function radiusLadder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-full'].map((token) =>
      root.getPropertyValue(token).trim(),
    );
  });
}

/**
 * Every element rendering a corner from `ladder`. The claim a radius set makes is "throughout", which
 * no list of selectors states — every `rounded-*` utility resolves through the same five tokens
 * (ADR-0075). The picker's own swatches are excluded: each shows the set it offers, not the one in force.
 */
function elementsRoundedBy(page: Page, ladder: readonly string[]): Promise<string[]> {
  return page.evaluate(
    (values) =>
      [...document.querySelectorAll('*')]
        .filter((element) => !element.closest('app-theme-radii'))
        .filter((element) => values.includes(getComputedStyle(element).borderTopLeftRadius))
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    [...ladder],
  );
}

test('the editor renders a control per declared tier-1 token, for both ColorSchemes at once', async ({ page }) => {
  const worldSeg = await enterEntities(page);
  await openThemeEditor(page, worldSeg);

  // Every anchor and knob the manifest declares is authorable, in *both* halves, from one seat: a
  // Theme and a reader's ColorScheme are orthogonal (ADR-0006), and an Owner who can only reach the
  // scheme they are sitting in ships half a Theme. Nothing here names a control the manifest doesn't.
  for (const { field, type } of PALETTE_FIELDS) {
    for (const scheme of ['light', 'dark']) {
      const control = page.getByTestId(`theme-control-${scheme}-${field}`);
      await expect(control, `${scheme} ${field}`).toBeVisible();
      // The control comes from the declared *type*: a colour gets a colour well, a knob a slider.
      await expect(control).toHaveAttribute('type', type === 'color' ? 'color' : 'range');
    }
  }

  await expect(page.getByTestId('theme-scheme-dark')).toBeVisible();
});

test('editing a value re-themes the interface immediately, and saving it survives a reload', async ({ page }) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  const beforeAccent = await resolvedOnRoot(page, '--color-accent');

  // Not saved, not reloaded — the control moves and the document is repainted from it.
  await page.getByTestId('theme-control-light-accent').fill('#6a2ab0');

  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#6a2ab0');
  // Tier 2 derives from tier 1 (ADR-0075), so one anchor re-themes every role above it.
  await expect.poll(() => resolvedOnRoot(page, '--color-accent')).not.toBe(beforeAccent);
  // A draft is not the World's Theme: nothing is stored until it is saved.
  expect(await storedTheme(page, worldId)).toBeFalsy();

  // Both halves in one sitting — the dark anchor is authored without toggling the reader's own scheme.
  await page.getByTestId('theme-control-dark-accent').fill('#33cc88');
  await page.getByTestId('theme-control-light-veil').fill('0.4');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');

  await saveTheme(page);

  const stored = await storedTheme(page, worldId);
  // Canonicalised at the write choke point (ADR-0076) — the notation the control sent stops mattering.
  expect(stored.light.accent).toMatch(/^oklch\(/);
  expect(stored.dark.accent).toMatch(/^oklch\(/);
  expect(stored.light.veil).toBe(0.4);

  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(stored.light.accent);
  // And the editor reopens on what stored, not on the Hexly default.
  await openThemeEditor(page, worldSeg);
  await expect(page.getByTestId('theme-control-light-veil')).toHaveValue('0.4');
});

/**
 * The Presets one ColorScheme column offers, read off the domain's own table (ADR-0077) — so a Preset
 * added there is picked here with no edit, and nothing below is a list kept in step by hand.
 */
const presetsOf = (scheme: WorldThemeSchemeKey) =>
  Object.values(PALETTE_PRESETS).filter((preset) => preset.scheme === scheme);

test('an Owner picks a Palette Preset, the interface repaints, and the mark follows the Palette', async ({ page }) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  // The suite's reset keeps Worlds *and* their Themes, so an earlier spec may have left this one themed.
  await clearTheme(page.request, worldId);
  await openThemeEditor(page, worldSeg);

  // An unthemed World already wears Hexly's own pair, so each column opens marked — derived by
  // comparison, since nothing stored says which Preset it is (ADR-0077).
  await expect(page.getByTestId('theme-preset-light-solar')).toBeChecked();
  await expect(page.getByTestId('theme-preset-dark-astral')).toBeChecked();

  // The unrelated halves of the contract first, so what a pick leaves alone is measured and not assumed.
  await page.getByTestId('theme-radii-sharp').check();
  await page.getByTestId('theme-font-codex').check();
  const darkPage = await page.getByTestId('theme-control-dark-page').inputValue();

  // Off the offer, so the first pick below is a pick rather than a click on an already-checked radio.
  await page.getByTestId('theme-control-light-accent').fill('#6a2ab0');
  await expect(page.getByTestId('theme-preset-light-solar')).not.toBeChecked();

  for (const preset of presetsOf('light')) {
    await page.getByTestId(`theme-preset-light-${preset.id}`).check();

    // One click for eleven, repainted on the click and stored nowhere — an Owner clicks through them.
    await expect.poll(() => inlineOnRoot(page, '--palette-page')).toBe(preset.values.page);
    await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(preset.values.accent);
    await expect.poll(() => inlineOnRoot(page, '--palette-veil')).toBe(String(preset.values.veil));

    // And the mark lands on that Preset alone: with a second Preset in the column it has *moved*.
    for (const other of presetsOf('light')) {
      await expect(page.getByTestId(`theme-preset-light-${other.id}`)).toBeChecked({
        checked: other.id === preset.id,
      });
    }
  }

  // Colours are not corners and not faces: choosing a Palette must not undo unrelated choices.
  expect(await inlineOnRoot(page, '--radius-md')).toBe('0px');
  expect(await inlineOnRoot(page, '--font-display')).toBe(FONT_PAIRINGS.codex['--font-display']);
  // Nor the other column — the two ColorSchemes are picked independently, with no pairing forced.
  expect(await page.getByTestId('theme-control-dark-page').inputValue()).toBe(darkPage);
  await expect(page.getByTestId('theme-preset-dark-astral')).toBeChecked();

  // Editing an anchor clears the mark: the Owner has moved away, and the editor must not say otherwise.
  await page.getByTestId('theme-control-light-ink').fill('#112233');
  for (const preset of presetsOf('light')) {
    await expect(page.getByTestId(`theme-preset-light-${preset.id}`)).not.toBeChecked();
  }

  // Trying Presets out is free: nothing was stored, and discard hands the World back unthemed.
  expect(await storedTheme(page, worldId)).toBeFalsy();
  await page.getByTestId('theme-discard').click();
  await expect.poll(() => inlineOnRoot(page, '--palette-page')).toBe('');
  expect(await storedTheme(page, worldId)).toBeFalsy();
});

test('a dark Palette Preset states its own field glow, as an override the Owner can hand back', async ({ page }) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  await clearTheme(page.request, worldId);
  await openThemeEditor(page, worldSeg);

  const [preset] = presetsOf('dark');
  // Off the offer first, for the reason the light column was moved off it above.
  await page.getByTestId('theme-control-dark-canvas').fill('#101020');
  await expect(page.getByTestId(`theme-preset-dark-${preset.id}`)).not.toBeChecked();

  await page.getByTestId(`theme-preset-dark-${preset.id}`).check();

  // The stylesheet keys off `[data-color-scheme]` and a stored Theme carries no Preset id, so a
  // per-Preset field glow can only be an override (ADR-0077) — and it genuinely is one, which the
  // editor shows rather than hides.
  await page.getByTestId('theme-override-group-canvas').locator('summary').click();
  const glow = page.getByTestId('theme-override-dark-color-canvas-glow');
  await expect(glow).toBeVisible();
  // In *this* Preset's own colours: the row carries the literal the table gave it, so a warm-charcoal
  // World does not glow with the indigo the default dark Preset happens to state.
  await expect(glow).toHaveValue(colorTokenHex(preset.overrides?.['--color-canvas-glow'] ?? '') ?? '');

  await saveTheme(page);
  const stored = await storedTheme(page, worldId);
  expect(stored.overrides.dark['--color-canvas-glow']).toBeTruthy();
  // Values and no name: no Preset id reaches stored data, which is what makes renaming one free.
  for (const id of Object.keys(PALETTE_PRESETS)) expect(JSON.stringify(stored)).not.toContain(id);

  // Reopened on the canonicalised Theme the server stored, the mark still derives to the same Preset —
  // the comparison is over what a control shows, not over the notation the table happens to author in.
  await openThemeEditor(page, worldSeg);
  await expect(page.getByTestId(`theme-preset-dark-${preset.id}`)).toBeChecked();

  // Nothing a Preset wrote is permanent: the row goes back to derived and the Theme back to none.
  await page.getByTestId('theme-override-group-canvas').locator('summary').click();
  await page.getByTestId('theme-override-clear-dark-color-canvas-glow').click();
  await expect(page.getByTestId('theme-override-set-dark-color-canvas-glow')).toBeVisible();
  await saveTheme(page);
  expect((await storedTheme(page, worldId)).overrides).toBeUndefined();

  await clearTheme(page.request, worldId);
});

test('cancelling puts the saved Theme back, and reset then saved returns the World to the Hexly default', async ({
  page,
}) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  await page.getByTestId('theme-control-light-accent').fill('#6a2ab0');
  await saveTheme(page);
  const saved = await storedTheme(page, worldId);

  // A failed experiment costs nothing: cancel drops the draft and the saved Theme paints again.
  await page.getByTestId('theme-control-light-accent').fill('#118844');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#118844');
  await page.getByTestId('theme-discard').click();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(saved.light.accent);

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

/** The four faces a pairing writes, each named by an element that actually renders in it. */
const PAIRING_FACES = [
  { token: '--font-display', selector: '.font-display' },
  { token: '--font-body', selector: 'body' },
  { token: '--font-cartouche', selector: '.font-cartouche' },
  { token: '--font-mono', selector: 'app-theme-control .readout' },
] as const;

/** A stack's first family — what a computed `font-family` is compared on, quoting being the engine's. */
const firstFamily = (stack: string) => stack.split(',')[0].replaceAll("'", '').trim();

test('an Owner picks a corner set and a font pairing, and the interface takes both through a save and a reload', async ({
  page,
}) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  // The ladder as the Hexly default renders it, so what follows is measured against real corners.
  const ladder = await radiusLadder(page);
  expect((await elementsRoundedBy(page, ladder)).length, 'the default rounds a great many corners').toBeGreaterThan(5);

  // A set, not five lengths: one pick squares the whole document — buttons, cards, chips and all.
  await page.getByTestId('theme-radii-sharp').check();
  await expect.poll(() => inlineOnRoot(page, '--radius-md')).toBe('0px');
  await expect.poll(() => elementsRoundedBy(page, ladder)).toEqual([]);

  // A pairing writes all four faces at once (spec §5.4), and each one is what renders.
  //
  // `codex` restates the manifest's own stacks, so the rendered face agrees with the default whether or
  // not the pick did anything: the before-state is what makes this bite. Until it is picked no face is
  // inline, and after it every one is — that transition is the pairing path, and it is the assertion a
  // second pairing would otherwise be needed to make.
  for (const { token } of PAIRING_FACES) {
    expect(await inlineOnRoot(page, token), `${token} is not inline before a pairing is picked`).toBe('');
  }

  await page.getByTestId('theme-font-codex').check();
  for (const { token, selector } of PAIRING_FACES) {
    const stack = FONT_PAIRINGS.codex[token] ?? '';
    expect(stack, `the curated pairing declares ${token}`).not.toBe('');
    await expect.poll(() => inlineOnRoot(page, token)).toBe(stack);
    expect(await computedOn(page, selector, 'font-family'), `${token} on ${selector}`).toContain(firstFamily(stack));
  }

  await saveTheme(page);

  const stored = await storedTheme(page, worldId);
  expect(stored.radii['--radius-md']).toBe('0px');
  expect(stored.fontPairing).toBe('codex');

  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--radius-full')).toBe('0px');
  expect(await elementsRoundedBy(page, ladder)).toEqual([]);

  // And the editor reopens on what stored, rather than on the offered default.
  await openThemeEditor(page, worldSeg);
  await expect(page.getByTestId('theme-radii-sharp')).toBeChecked();
  await expect(page.getByTestId('theme-font-codex')).toBeChecked();

  await clearTheme(page.request, worldId);
});

test('an anonymous Public Link visitor gets the corner set and the pairing too', async ({ page, browser }) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);

  // Read before picking: the corners the visitor's page would have rendered had nothing been stored.
  const ladder = await radiusLadder(page);
  await page.getByTestId('theme-radii-sharp').check();
  await page.getByTestId('theme-font-codex').check();
  await saveTheme(page);

  await page.getByTestId('settings-nav-sharing').click();
  const minted = page.waitForResponse(
    (r) => /\/api\/worlds\/[\w-]+\/link$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('public-link-create').click();
  await minted;
  const url = await page.getByTestId('public-link-url').inputValue();

  const anonContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonContext.newPage();
  await visitor.goto(url);
  await expect(visitor.getByTestId('public-banner')).toBeVisible();

  // Both ride the unauthenticated World read, as the Palette does (ADR-0076): a visitor with no
  // account sees the World the Owner authored rather than half of it.
  await expect.poll(() => inlineOnRoot(visitor, '--radius-md')).toBe('0px');
  await expect.poll(() => inlineOnRoot(visitor, '--font-display')).toBe(FONT_PAIRINGS.codex['--font-display']);
  expect(await elementsRoundedBy(visitor, ladder)).toEqual([]);
  expect(await computedOn(visitor, 'body', 'font-family')).toContain(
    firstFamily(FONT_PAIRINGS.codex['--font-body'] ?? ''),
  );

  await anonContext.close();
  await clearTheme(page.request, worldId);
  expect((await page.request.delete(`/api/worlds/${worldId}/link`)).ok()).toBeTruthy();
});

test('a Theme edit changes nothing about what Entities contain or who can read them', async ({ page, request }) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  const before = await (await request.get(`/api/worlds/${worldId}/graph`)).json();

  await openThemeEditor(page, worldSeg);
  await page.getByTestId('theme-control-light-accent').fill('#6a2ab0');
  await saveTheme(page);

  const after = await (await request.get(`/api/worlds/${worldId}/graph`)).json();
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
});

// Both non-manage roles, because #371 gates on the right and not on the role: a Viewer reaching the
// editor and a Contributor reaching it are the same defect, and only one of them was covered.
for (const role of ['contributor', 'viewer'] as const) {
  test(`a ${role} does not reach the Theme editor`, async ({ page, request, browser }) => {
    const worldSeg = await enterEntities(page);
    // Over the API rather than the Access pane: the reset keeps Worlds *and* their members, so by the
    // time this spec runs the second user may already hold a role here — and the add picker, which
    // offers only non-members, would then have nothing to select. The POST is an upsert either way.
    const directory: { id: string; displayName: string }[] = await (await request.get('/api/users/directory')).json();
    const grantee = directory.find((user) => user.displayName === TEST_GRANTEE.displayName);
    expect(grantee, 'the second seeded user is in the Instance directory').toBeTruthy();
    const added = await request.post(`/api/worlds/${idFromSegment(worldSeg)}/members`, {
      data: { userId: grantee!.id, role },
    });
    expect(added.ok(), await added.text()).toBeTruthy();

    const member = await signInGrantee(browser);
    await member.goto(`/w/${worldSeg}/settings`);

    // The Settings shell renders for any reader, so anchor on a section that is *there* first — an
    // absence asserted before the rail renders is an absence of everything, and proves nothing.
    await expect(member.getByTestId('settings-nav-schema')).toBeVisible();

    // Authoring identity is a manage right (ADR-0039); neither role holds one.
    await expect(member.getByTestId('settings-nav-theme')).toHaveCount(0);
    await expect(member.getByTestId('theme-save')).toHaveCount(0);

    await member.context().close();
  });
}

test('the readability report covers the ColorScheme the author is not looking at, and a failing Theme still saves', async ({
  page,
}) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  await openThemeEditor(page, worldSeg);
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  await expect(page.locator('[data-testid^="theme-warning-dark"]')).toHaveCount(0);

  // Dark ink a shade off the dark page — illegible, in the half of the Theme nobody is looking at.
  await page.getByTestId('theme-control-dark-ink').fill('#12142a');

  const dark = page.getByTestId('theme-warning-dark-contrast-ink-bg');
  await expect(dark).toBeVisible();
  // The ratio is shown, so an Owner judges rather than guesses (ADR-0076).
  await expect(dark).toHaveText(/\d+\.\d\d:1/);
  await expect(page.getByTestId('theme-warning-dark-contrast-ink-surface')).toBeVisible();
  // The reader is in light and the light ink has not moved, so the warning cannot be the active Palette's
  // wearing the other one's name. That is the assertion the whole feature turns on.
  await expect(page.getByTestId('theme-warning-light-contrast-ink-bg')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');

  // And the mirror image: put dark back, break light, and the two reports swap over.
  await page.getByTestId('theme-control-dark-ink').fill('#ece3cf');
  await page.getByTestId('theme-control-light-ink').fill('#efe4c8');
  await expect(page.getByTestId('theme-warning-light-contrast-ink-bg')).toBeVisible();
  await expect(page.getByTestId('theme-warning-dark-contrast-ink-bg')).toHaveCount(0);

  // Warn, never block: a deliberately oppressive Palette in a horror World is a legitimate choice, and
  // a block just gets routed around by overriding a different token (ADR-0076).
  await saveTheme(page);
  expect(await storedTheme(page, worldId)).toBeTruthy();

  await restoreDefaultTheme(page);
});

test('a mid-tone accent and a tone rotated into a status colour each get their own warning, and on-colours flip unasked', async ({
  page,
}) => {
  const worldSeg = await enterEntities(page);
  await openThemeEditor(page, worldSeg);

  // `contrast-color()` answers black or white and nothing between, so a mid-tone accent is one no
  // automatic foreground rescues — CSS cannot resolve it, and only reading it back makes it visible.
  await page.getByTestId('theme-control-light-accent').fill('#bb00ff');
  await expect(page.getByTestId('theme-warning-light-midtone')).toBeVisible();

  // Re-anchoring the accent rotates all eight categorical tones with it, so the exclusion the check
  // computes against Hexly's accent stops holding for theirs: at this hue tone 6 lands on success,
  // ΔE00 5.6 against a bar of 10 (ADR-0075).
  await page.getByTestId('theme-control-light-accent').fill('#0099cc');
  await expect(page.getByTestId('theme-warning-light-midtone')).toHaveCount(0);
  await expect(page.getByTestId('theme-warning-light-tone-6-success')).toBeVisible();

  // On-colours flip silently and with no control of their own: the Owner moved the accent, and the
  // foreground that sits on it went the other way (ADR-0076).
  await expect(page.getByTestId('theme-control-light-onFill')).toHaveCount(0);
  await page.getByTestId('theme-control-light-accent').fill('#f5e6b0');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#f5e6b0');
  expect(await brightnessOnRoot(page, '--color-on-fill')).toBeLessThan(200);

  await page.getByTestId('theme-control-light-accent').fill('#241a05');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('#241a05');
  expect(await brightnessOnRoot(page, '--color-on-fill')).toBeGreaterThan(600);
  // Nothing is saved here, so nothing needs handing back: leaving the editor is a cancel (#371).
});

/** One ColorScheme's eleven authored values, as a World an Owner has already themed carries them. */
const SOURCE_PALETTE = {
  page: '#f1e5c7',
  ink: '#2e2412',
  inkQuiet: '#6f5a36',
  accent: '#6a2ab0',
  danger: '#a4402e',
  success: '#4a6f2f',
  canvas: '#efe2bf',
  soot: '#3c2c16',
  polarity: 1,
  lineAlpha: 0.371,
  veil: 0.12,
};

/**
 * A whole authored Theme, corner set and all, so the copy has more than a Palette to carry. The radii
 * are spelled out rather than taken from the editor's preset table: that table lives behind Angular
 * imports this process must not pull in (see `fixtures.ts`).
 */
const SOURCE_THEME = {
  version: 2,
  light: SOURCE_PALETTE,
  dark: { ...SOURCE_PALETTE, polarity: -1 },
  radii: {
    '--radius-sm': '0px',
    '--radius-md': '0px',
    '--radius-lg': '0px',
    '--radius-xl': '0px',
    '--radius-full': '0px',
  },
};

/** Mint a World of the caller's own and give it `theme`, returning its id. */
async function themedWorld(request: APIRequestContext, name: string, theme: unknown): Promise<string> {
  const created = await request.post('/api/worlds', { data: { name } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  expect((await request.patch(`/api/worlds/${id}`, { data: { theme } })).ok()).toBeTruthy();
  return id;
}

test('an Owner copies another World’s Theme in, keeps editing it, and the source stops mattering', async ({
  page,
  request,
}) => {
  const worldSeg = await enterEntities(page);
  const worldId = idFromSegment(worldSeg);
  // The suite's reset keeps Worlds *and* their Themes, so an earlier spec may have left this one
  // themed; the copy is judged against a World that carries none.
  await clearTheme(request, worldId);
  const sourceId = await themedWorld(request, 'Whisperwood', SOURCE_THEME);
  // A World of theirs carrying no Theme has nothing to copy, so it must not be on the list at all.
  const unthemed = await (await request.post('/api/worlds', { data: { name: 'Nothing authored yet' } })).json();

  await openThemeEditor(page, worldSeg);

  // The offer is the server's (`GET /worlds/:id/theme-sources`): the caller's *other* Worlds, carrying
  // a Theme. Neither this World nor the unthemed one qualifies, so neither is offered.
  const options = page.getByTestId('theme-copy-source').locator('option');
  await expect(options.filter({ hasText: 'Whisperwood' })).toHaveCount(1);
  const offered = await options.evaluateAll((all) => all.map((one) => (one as HTMLOptionElement).value));
  expect(offered).not.toContain(unthemed.id);
  expect(offered).not.toContain(worldId);

  const source = await storedTheme(page, sourceId);
  await page.getByTestId('theme-copy-source').selectOption(sourceId);
  await page.getByTestId('theme-copy').click();

  // Staged, not applied (#376): the whole contract previews at once — the corner set as much as the
  // anchors — and *nothing is stored*, so an Owner judges the copy in place before committing to it.
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(source.light.accent);
  await expect.poll(() => inlineOnRoot(page, '--radius-md')).toBe('0px');
  expect(await storedTheme(page, worldId)).toBeFalsy();

  // Which means cancel is still cancel: a copy previewed and thought better of costs nothing.
  await page.getByTestId('theme-discard').click();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('');
  await expect.poll(() => inlineOnRoot(page, '--radius-md')).toBe('');

  // Copy again, then edit the copy before saving — it is this World's own draft, not a reference.
  await page.getByTestId('theme-copy').click();
  await page.getByTestId('theme-control-light-ink').fill('#112233');
  await saveTheme(page);

  const copied = await storedTheme(page, worldId);
  expect(copied.light.accent).toBe(source.light.accent);
  expect(copied.dark.polarity).toBe(-1);
  expect(copied.radii['--radius-md']).toBe('0px');
  // The edit rode the same save, through the same PATCH choke point as any other Theme write.
  expect(copied.light.ink).not.toBe(source.light.ink);

  // A duplicate, not a link (ADR-0076): re-theming the source afterwards leaves the copy alone.
  expect(
    (
      await request.patch(`/api/worlds/${sourceId}`, {
        data: { theme: { ...SOURCE_THEME, light: { ...SOURCE_PALETTE, accent: '#0a7d55' } } },
      })
    ).ok(),
  ).toBeTruthy();

  await page.reload();
  expect(await storedTheme(page, worldId)).toEqual(copied);
  // And what renders is still the copy's accent, not the source's new one.
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(copied.light.accent);

  await clearTheme(page.request, worldId);
  await clearTheme(page.request, sourceId);
});
