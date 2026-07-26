import type { Page } from '@playwright/test';
import { DESIGN_TOKENS, DesignToken, registeredTokens } from '@hexly/web-styles';
import { enterLibrary, expect, test } from './fixtures';

/** The `@property` registrations, in a real engine — jsdom has none, so nothing else can see them. */

/** A colour the engine has resolved: never a hex, a bare keyword, or an unevaluated expression. */
const ABSOLUTE_COLOR = /^(rgba?|oklch|oklab|lab|lch|color)\(/;

/** What the document resolves each token to, as the Canvas renderers read them (ADR-0075). */
function resolve(page: Page, names: readonly DesignToken[]): Promise<Record<string, string>> {
  return page.evaluate((tokens) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(tokens.map((name) => [name, style.getPropertyValue(name).trim()]));
  }, names as string[]);
}

test('a registered colour token reads back resolved, an unregistered one reads back raw', async ({ page }) => {
  await enterLibrary(page);

  const colors = registeredTokens()
    .filter((decl) => decl.type === 'color')
    .map((decl) => decl.name);
  // `--tracking-wider` is the control: unregistered, so it still comes back as the `em` it was written
  // as rather than the `px` a registered `<length>` would have computed at the root.
  const resolved = await resolve(page, [...colors, '--tracking-wider']);

  const raw = colors.filter((name) => !ABSOLUTE_COLOR.test(resolved[name] ?? ''));
  expect(raw, 'every registered colour token resolves to an absolute colour').toEqual([]);
  expect(resolved['--tracking-wider']).toMatch(/em$/);
});

test('every declared token is actually declared by the stylesheets the app ships', async ({ page }) => {
  await enterLibrary(page);

  const resolved = await resolve(
    page,
    DESIGN_TOKENS.map((decl) => decl.name),
  );

  expect(Object.entries(resolved).filter(([, value]) => value === '')).toEqual([]);
});
