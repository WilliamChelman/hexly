import type { APIRequestContext, Page } from '@playwright/test';
import { enterLibrary, expect, preferencesPatched, segRe, test } from './fixtures';
// The app's own pretty-URL codec (ADR-0042), imported by file path for the reason `fixtures.ts` gives.
import { idFromSegment, segment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * A World Theme is applied (ADR-0076): each World adopts its own identity as the reader arrives, the
 * reader keeps their own ColorScheme within it, and a reload back into a World they have seen paints
 * themed without a flash.
 *
 * Everything here drives the stored Theme over the API — there is no editor yet (#371) — and asserts
 * the *inline* custom properties on `<html>`, because that is the mechanism: an inline property beats
 * both ColorSchemes' stylesheet rules, and it is what a later override leans on.
 */

/** A crimson World: far enough from Hexly's own gold that a half-applied Theme is visible. */
const CRIMSON = {
  version: 1,
  solar: {
    page: '#f8e8e6',
    ink: '#2a1210',
    inkQuiet: '#7a4340',
    accent: '#b02a2a',
    danger: '#8f3a20',
    success: '#4a6f2f',
    canvas: '#f2dcd9',
    soot: '#3a1412',
    polarity: 1,
    lineAlpha: 0.371,
    veil: 0.12,
  },
  astral: {
    page: '#170a0c',
    ink: '#f2dcd9',
    inkQuiet: '#c08e8a',
    accent: '#ef8080',
    danger: '#e88a6f',
    success: '#86c46a',
    canvas: '#1e0d10',
    soot: '#0a0203',
    polarity: -1,
    lineAlpha: 0.16,
    veil: 0.5,
  },
};

/** A second, unmistakably different accent — the edit a live-following reader must receive. */
const VIOLET = { ...CRIMSON, solar: { ...CRIMSON.solar, accent: '#6a2ab0' } };

/** Patch a World's Theme and hand back what the choke point canonicalised it to (ADR-0076). */
async function storeTheme(request: APIRequestContext, worldId: string, theme: unknown) {
  const res = await request.patch(`/api/worlds/${worldId}`, { data: { theme } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).theme as typeof CRIMSON;
}

/** A custom property as it sits *inline* on `<html>` — empty when the applier has written none. */
function inlineOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => document.documentElement.style.getPropertyValue(token), name);
}

/** A custom property as the engine resolves it on `selector`, which is what actually renders. */
function resolvedOn(page: Page, selector: string, name: string): Promise<string> {
  return page.evaluate(
    ([sel, token]) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(token).trim(),
    [selector, name] as const,
  );
}

/** What an offscreen element carrying `scheme` resolves `name` to (world-theme-spec §5.3). */
function probe(page: Page, scheme: 'solar' | 'astral', names: readonly string[]): Promise<string[]> {
  return page.evaluate(
    ([colorScheme, tokens]) => {
      const element = document.createElement('div');
      element.dataset['colorScheme'] = colorScheme as string;
      document.body.append(element);
      const style = getComputedStyle(element);
      const values = (tokens as string[]).map((token) => style.getPropertyValue(token).trim());
      element.remove();
      return values;
    },
    [scheme, names] as const,
  );
}

/** Clear a World's Theme, so a themed World does not outlive the test that themed it. */
async function clearTheme(request: APIRequestContext, worldId: string): Promise<void> {
  expect((await request.patch(`/api/worlds/${worldId}`, { data: { theme: null } })).ok()).toBeTruthy();
}

test('a Theme paints the World it belongs to, reaches what portals off the root, and gives way when the reader leaves', async ({
  page,
  request,
}) => {
  const worldSeg = await enterLibrary(page);
  const theme = await storeTheme(request, idFromSegment(worldSeg), CRIMSON);
  const plain = await (await request.post('/api/worlds', { data: { name: 'Undyed' } })).json();

  await page.reload();

  // The anchors land inline on the document root, through the CSSOM — never an injected stylesheet.
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(theme.solar.accent);
  await expect.poll(() => inlineOnRoot(page, '--palette-page')).toBe(theme.solar.page);
  // Tier 2 derives from tier 1 (ADR-0075), so writing the anchors re-themes the whole interface.
  expect(await resolvedOn(page, 'html', '--color-accent')).toBe(await resolvedOn(page, 'html', '--palette-accent'));

  // A CDK overlay portals to <body>, so a subtree-scoped Theme would leave every menu and dialog
  // unthemed. This one is the masthead's user menu.
  await page.locator('app-user-menu button').click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await resolvedOn(page, '.cdk-overlay-container [role=menu]', '--palette-accent')).toBe(
    await resolvedOn(page, 'html', '--palette-accent'),
  );
  await page.keyboard.press('Escape');

  // An offscreen element carrying the *other* ColorScheme resolves that scheme's tier-1 Palette, not
  // the reader's and not the World's — Hexly's own Astral anchors, since a probe carries none of its
  // own until one is put on it. This is what the widened selector bought (ADR-0076).
  //
  // Tier 2 does *not* follow it, and this pins that: the roles are declared once at `:root` by the
  // `@theme` block, and a registered custom property computes where it is declared — so the probe
  // inherits the root's already-derived `--color-*` rather than re-deriving from its own anchors.
  // #373's contrast probe needs the whole chain, so it must either re-declare tier 2 per
  // `[data-color-scheme]` or measure on the root itself between paints.
  const [probedAnchor, probedRole] = await probe(page, 'astral', ['--palette-page', '--color-bg']);
  expect(probedAnchor).toBe('rgb(11, 12, 26)');
  expect(probedRole).toBe(await resolvedOn(page, 'html', '--color-bg'));

  // Which is why a renderer resolves its colours off the root and never off its own canvas
  // (`designTokenStyle`): a canvas inside a scheme-carrying subtree would read that subtree's anchors
  // and the root's derived roles at once, and paint half of each with nothing to show for it.
  const canvasStraddle = await page.evaluate(() => {
    const scoped = document.createElement('div');
    scoped.dataset['colorScheme'] = 'astral';
    const canvas = scoped.appendChild(document.createElement('canvas'));
    document.body.append(scoped);
    const read = (el: Element, token: string) => getComputedStyle(el).getPropertyValue(token).trim();
    const straddled = read(canvas, '--palette-page') !== read(document.documentElement, '--palette-page');
    scoped.remove();
    return straddled;
  });
  expect(canvasStraddle, 'a canvas in a scheme-carrying subtree reads anchors the root does not').toBe(true);

  // Leaving for a World with no Theme takes it back: nothing is worse than it is today.
  await page.goto(`/w/${segment(plain.id, plain.name)}`);
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(plain.id)}$`));
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe('');
  expect(await resolvedOn(page, 'html', '--color-accent')).not.toBe(theme.solar.accent);

  await clearTheme(request, idFromSegment(worldSeg));
  // The reset keeps Worlds, so the unthemed one this test needed does not outlive it.
  expect((await request.delete(`/api/worlds/${plain.id}`)).ok()).toBeTruthy();
});

test('a reload into a World already visited paints themed before anything is fetched', async ({ page, request }) => {
  const worldSeg = await enterLibrary(page);
  const theme = await storeTheme(request, idFromSegment(worldSeg), CRIMSON);
  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(theme.solar.accent);

  // Cut off the API *and* every script the document loads, so the only code that can have run is the
  // pre-paint replay inline in `<head>`. That is the difference between flash-free and merely fast:
  // the Theme is on the root before Angular exists, let alone before the World read returns.
  await page.route('**/api/**', (route) => route.abort());
  await page.route('**/*.js', (route) => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);

  expect(await inlineOnRoot(page, '--palette-accent')).toBe(theme.solar.accent);
  expect(await page.evaluate(() => document.querySelector('app-root')?.childElementCount)).toBe(0);
  await page.unrouteAll();

  await clearTheme(request, idFromSegment(worldSeg));
});

test('the reader keeps their own ColorScheme inside a themed World, and gets that scheme’s Palette', async ({
  page,
  request,
}) => {
  const worldSeg = await enterLibrary(page);
  const theme = await storeTheme(request, idFromSegment(worldSeg), CRIMSON);
  await page.reload();
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(theme.solar.accent);

  // The ColorScheme roams with the account (ADR-0038) and the e2e account is shared, so hand it back.
  const toggled = preferencesPatched(page);
  await page.locator('app-user-menu button').click();
  await page.getByRole('menuitem', { name: /switch to the astral colour scheme/i }).click();
  await toggled;

  // The reader's choice stands — a World Owner does not get to override day/night — and the Theme
  // follows it to its other Palette.
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'astral');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(theme.astral.accent);

  const restored = preferencesPatched(page);
  await page.locator('app-user-menu button').click();
  await page.getByRole('menuitem', { name: /switch to the solar colour scheme/i }).click();
  await restored;
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'solar');

  await clearTheme(request, idFromSegment(worldSeg));
});

test('a Theme edit reaches a live-following reader, and an anonymous Public Link visitor sees it too', async ({
  page,
  request,
  browser,
}) => {
  const worldSeg = await enterLibrary(page);
  const worldId = idFromSegment(worldSeg);
  const crimson = await storeTheme(request, worldId, CRIMSON);
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(crimson.solar.accent);

  // A Theme edit bumps the World's freshness key, so the open page re-applies with no reload — the
  // Owner tweaking their palette while players watch.
  const violet = await storeTheme(request, worldId, VIOLET);
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(violet.solar.accent);

  // Mint the World Public Link and open it with no account at all.
  await page.goto(`/w/${worldSeg}/settings`);
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

  // The Theme rides the unauthenticated read, so a visitor with no account is themed like a member.
  await expect.poll(() => inlineOnRoot(visitor, '--palette-accent')).toBe(violet.solar.accent);

  await anonContext.close();
  await clearTheme(request, worldId);
  expect((await request.delete(`/api/worlds/${worldId}/link`)).ok()).toBeTruthy();
});
