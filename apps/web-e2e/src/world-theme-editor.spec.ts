import type { Page } from '@playwright/test';
import { DESIGN_TOKENS } from '@hexly/web-styles';
import { addWorldMember, enterLibrary, expect, signInGrantee, test } from './fixtures';
// The app's own pretty-URL codec (ADR-0042), imported by file path for the reason `fixtures.ts` gives.
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * A World Owner authors their Palette and watches it apply (ADR-0076, #371).
 *
 * The unit tests own the mapping — draft to layer, reset, which control a declared type picks. What
 * only a browser can answer is here: that moving a control re-themes the running interface, that both
 * ColorSchemes are authorable from one seat, and that a Contributor never reaches the editor at all.
 */

/** The stored Palette field each tier-1 token is authored through, straight off the manifest. */
const PALETTE_FIELDS = DESIGN_TOKENS.filter((decl) => decl.tier === 'palette').map((decl) => ({
  field: decl.name.replace(/^--palette-/, '').replace(/-(\w)/g, (_, c: string) => c.toUpperCase()),
  type: decl.type,
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

test('a Contributor does not reach the Theme editor', async ({ page, browser }) => {
  const worldSeg = await enterLibrary(page);
  await addWorldMember(page, worldSeg, 'contributor');

  const contributor = await signInGrantee(browser);
  await contributor.goto(`/w/${worldSeg}/settings`);

  // Authoring a Theme is a manage right (ADR-0039); a Contributor writes Entities, not identity.
  await expect(contributor.getByTestId('settings-nav-schema')).toHaveCount(0);
  await expect(contributor.getByTestId('settings-nav-theme')).toHaveCount(0);
  await expect(contributor.getByTestId('theme-save')).toHaveCount(0);

  await contributor.context().close();
});
