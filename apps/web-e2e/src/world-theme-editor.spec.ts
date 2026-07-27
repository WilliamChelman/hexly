import type { APIRequestContext, Page } from '@playwright/test';
import { designToken } from '@hexly/web-styles';
import { FONT_PAIRINGS, PALETTE_TOKENS } from '@hexly/domain';
import { enterLibrary, expect, signInGrantee, test } from './fixtures';
import { TEST_GRANTEE } from './test-user';
// The app's own pretty-URL codec (ADR-0042), imported by file path for the reason `fixtures.ts` gives.
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * A World Owner authors their Palette and watches it apply (ADR-0076, #371).
 *
 * The unit tests own the mapping — draft to layer, reset, which control a declared type picks. What
 * only a browser can answer is here: that moving a control re-themes the running interface, that both
 * ColorSchemes are authorable from one seat, and that a Contributor never reaches the editor at all.
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
 * Every element rendering a corner from `ladder`, named for a failure to be readable. The claim a
 * radius set makes is "throughout", and no list of selectors states that — every `rounded-*` utility
 * resolves through the same five tokens (ADR-0075), so a set that squares the ladder squares them all.
 *
 * The picker's own swatches are excluded: each shows the set it *offers*, not the one in force.
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
  const worldSeg = await enterLibrary(page);
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
  await page.getByTestId('theme-font-codex').check();
  for (const { token, selector } of PAIRING_FACES) {
    const stack = FONT_PAIRINGS.codex[token] ?? '';
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
  const worldSeg = await enterLibrary(page);
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
