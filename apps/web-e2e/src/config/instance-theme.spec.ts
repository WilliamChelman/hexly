import type { APIRequestContext, Page } from '@playwright/test';
import { enterLibrary, expect, segRe, test } from '../fixtures';
// The app's own pretty-URL codec (ADR-0042), imported by file path for the reason `fixtures.ts` gives.
import { idFromSegment, segment } from '../../../../libs/web-core/src/utils/pretty-id';

/**
 * An Instance default Theme in `hexly.yml` — via its own server (ADR-0076, #372; ADR-0052, Seam 4;
 * server in `playwright.config.ts`). The configured layer is partial (one anchor per ColorScheme, one
 * radius) because a whole-Theme layer could not show the field-by-field precedence.
 */

/** A crimson World Theme, far enough from the operator's green that a mix-up is visible. */
const CRIMSON = {
  version: 2,
  light: {
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
  dark: {
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

/**
 * Take back every stored World Theme. The DB reset keeps Worlds, so one left behind by a failed test
 * would mask the Instance default the tests either side of it assert — turning one red into a stuck run.
 */
test.afterEach(async ({ request }) => {
  const worlds = (await (await request.get('/api/worlds')).json()) as { id: string }[];
  for (const world of worlds) await request.patch(`/api/worlds/${world.id}`, { data: { theme: null } });
});

/** A custom property as it sits *inline* on `<html>` — what the applier wrote, and nothing else. */
function inlineOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => document.documentElement.style.getPropertyValue(token), name);
}

/** A custom property as the engine resolves it on the root, which is what actually renders. */
function resolvedOnRoot(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
}

/** Patch a World's Theme and hand back what the choke point canonicalised it to (ADR-0076). */
async function storeTheme(request: APIRequestContext, worldId: string, theme: unknown) {
  const res = await request.patch(`/api/worlds/${worldId}`, { data: { theme } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).theme as typeof CRIMSON;
}

test('the operator’s default is served on the config channel, canonicalised like an Owner’s', async ({ request }) => {
  const config = await (await request.get('/api/config')).json();

  // Operator-supplied is still input: the same choke point re-serialises it, so what crosses is a
  // colour by construction rather than by trust (ADR-0076).
  expect(config.theme.version).toBe(2);
  expect(config.theme.light.accent).toMatch(/^oklch\(/);
  expect(config.theme.dark.accent).toMatch(/^oklch\(/);
  expect(config.theme.radii['--radius-md']).toBe('0px');
  // Partial on purpose: everything the operator was silent about must fall through to the stylesheet.
  expect(config.theme.light.page).toBeUndefined();
});

test('every World without a Theme of its own adopts the Instance default, and so does the Index', async ({
  page,
  request,
}) => {
  const config = await (await request.get('/api/config')).json();
  const branded = config.theme.light.accent;

  // The Instance layer is not a World's, so it applies where no World is open.
  await page.goto('/');
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(branded);
  await expect.poll(() => inlineOnRoot(page, '--radius-md')).toBe('0px');
  // Tier 2 derives from tier 1 (ADR-0075), so branding the anchor re-themes the whole interface.
  expect(await resolvedOnRoot(page, '--color-accent')).toBe(await resolvedOnRoot(page, '--palette-accent'));

  // And inside a World that has authored none: the branding is the floor, not an Index-only fallback.
  await enterLibrary(page);
  expect(await inlineOnRoot(page, '--palette-accent')).toBe(branded);
  expect(await inlineOnRoot(page, '--radius-md')).toBe('0px');
});

test('a World with its own Theme overrides the Instance default field by field, and gives it back on leaving', async ({
  page,
  request,
}) => {
  const config = await (await request.get('/api/config')).json();
  const branded = config.theme.light.accent;
  const worldSeg = await enterLibrary(page);
  const theme = await storeTheme(request, idFromSegment(worldSeg), CRIMSON);
  const plain = await (await request.post('/api/worlds', { data: { name: 'Undyed' } })).json();

  await page.reload();

  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(theme.light.accent);
  expect(theme.light.accent).not.toBe(branded);
  // The Instance default survives where the World Theme is silent — this Theme carries no radii.
  expect(await inlineOnRoot(page, '--radius-md')).toBe('0px');

  // Leaving for a World with no Theme falls back to the Instance default rather than to Hexly's own.
  await page.goto(`/w/${segment(plain.id, plain.name)}`);
  await expect(page).toHaveURL(new RegExp(`/w/${segRe(plain.id)}$`));
  await expect.poll(() => inlineOnRoot(page, '--palette-accent')).toBe(branded);

  // The reset keeps Worlds, so the second one this test needed does not outlive it.
  expect((await request.delete(`/api/worlds/${plain.id}`)).ok()).toBeTruthy();
});
