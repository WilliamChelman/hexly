import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DESIGN_TOKENS, registeredTokens, TokenType } from '@hexly/web-styles';
import { expect, preferencesPatched, test } from './fixtures';

/**
 * The token snapshot (ADR-0075, world-theme-spec §7): every declared token's resolved value, in both
 * ColorSchemes, against the committed table at {@link TABLE_PATH}.
 *
 * Resolved values, never how a token is spelled — asserting the expressions would freeze the formulas
 * the table exists to protect. So it is read out of a real engine, and a registered token reading back
 * as its raw declaration fails here: that is the failure that would break the Canvas renderers.
 *
 * `UPDATE_TOKEN_TABLE=1` rewrites the table. Not Playwright's own snapshots, which key the file by
 * project and platform — this is one artifact, and the derivation work's diff to it is the point.
 */

const TABLE_PATH = join(__dirname, 'design-tokens.table.json');

/**
 * The day/night axis (ADR-0075), spelled here rather than imported: the `@hexly/web-core` barrel pulls
 * Angular into the Playwright process, and a `type`-only import is one careless edit away from doing it.
 */
type ColorScheme = 'solar' | 'astral';

const COLOR_SCHEMES = ['solar', 'astral'] as const satisfies readonly ColorScheme[];

/** One token's resolved value in each ColorScheme, as the committed table records it. */
type TokenTable = Record<string, Record<ColorScheme, string>>;

/**
 * What an engine-resolved value looks like, per type. `null` for the types `@property` has no syntax
 * component for, which is why they read back as the raw token stream the stylesheet wrote — the table
 * records those, and registering one anyway is unverifiable and so counts as unresolved below.
 */
const RESOLVED_SHAPE: Readonly<Record<TokenType, RegExp | null>> = {
  color: /^(rgba?|oklch|oklab|lab|lch|color)\(/,
  number: /^-?\d+(\.\d+)?$/,
  // A registered `<length>` computes at the root, so every relative unit is gone by the time we read it.
  length: /^-?\d+(\.\d+)?px$/,
  time: /^\d+(\.\d+)?m?s$/,
  easing: null,
  shadow: null,
  gradient: null,
  'font-pairing': null,
};

/** What the document resolves each token to, exactly as the Canvas renderers read them (ADR-0075). */
function resolve(page: Page, names: readonly string[]): Promise<Record<string, string>> {
  return page.evaluate((tokens) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(tokens.map((name) => [name, style.getPropertyValue(name).trim()]));
  }, names as string[]);
}

/** Paint the app in `scheme` through the real preference control, and wait for the root to carry it. */
async function chooseColorScheme(page: Page, scheme: ColorScheme): Promise<void> {
  await page.getByTestId(`color-scheme-${scheme}`).click();
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme);
}

/**
 * Every declared token's resolved value in both ColorSchemes, read off the live root element.
 *
 * Settings is the surface because it carries the ColorScheme control; the tokens are declared on
 * `:root`, so any page would read the same values.
 */
async function collect(page: Page): Promise<TokenTable> {
  await page.goto('/settings');
  // The ColorScheme roams via the account bag and hydrates when `/auth/me` resolves (ADR-0038):
  // choosing before that lands would be overwritten. The email is that same payload, on screen.
  await expect(page.getByTestId('email')).not.toBeEmpty();

  const names = DESIGN_TOKENS.map((decl) => decl.name);
  const observed = {} as Record<ColorScheme, Record<string, string>>;
  try {
    for (const scheme of COLOR_SCHEMES) {
      await chooseColorScheme(page, scheme);
      observed[scheme] = await resolve(page, names);
    }
  } finally {
    // The preference roams on the shared e2e account and outlives the entities-only reset, so hand the
    // suite back the ColorScheme it lent us — on the failing path too, and waiting for the roaming
    // write, which is otherwise fire-and-forget.
    const restored = preferencesPatched(page);
    await chooseColorScheme(page, 'solar');
    await restored;
  }

  return Object.fromEntries(
    names.map((name) => [name, { solar: observed.solar[name], astral: observed.astral[name] }]),
  );
}

test('every token reads back resolved and matches the committed table, in both ColorSchemes', async ({ page }) => {
  const table = await collect(page);

  const missing = Object.entries(table).filter(([, values]) => COLOR_SCHEMES.some((scheme) => values[scheme] === ''));
  expect(
    missing.map(([name]) => name),
    'every declared token is declared by the stylesheets we ship',
  ).toEqual([]);

  for (const scheme of COLOR_SCHEMES) {
    const raw = registeredTokens().filter((decl) => {
      const shape = RESOLVED_SHAPE[decl.type];
      return !shape || !shape.test(table[decl.name][scheme]);
    });
    expect(
      raw.map((decl) => decl.name),
      `every registered token resolves in ${scheme}`,
    ).toEqual([]);
  }

  // The control: `--tracking-wider` is deliberately unregistered, so it still reads back as the `em` it
  // was written as rather than the `px` a registered `<length>` computes to. Without it, a run where
  // registration had silently stopped working would still satisfy the loop above vacuously.
  expect(table['--tracking-wider'].solar).toMatch(/em$/);

  // The one thing assertable about the tokens `@property` has no syntax component for (the shadows and
  // the font stacks): substitution still has to have happened. A surviving `var()` is a cycle or a
  // typo, and the shape check above cannot see it because those tokens have no shape to check.
  const unsubstituted = Object.entries(table).filter(([, values]) =>
    COLOR_SCHEMES.some((scheme) => values[scheme].includes('var(')),
  );
  expect(
    unsubstituted.map(([name]) => name),
    'no token reads back still carrying a var()',
  ).toEqual([]);

  // Rewritten only once the values above are known to be resolved, so a reflexive regenerate cannot
  // commit a table of raw declarations.
  if (process.env.UPDATE_TOKEN_TABLE === '1' && !process.env.CI) {
    writeFileSync(TABLE_PATH, `${JSON.stringify(table, null, 2)}\n`);
  }

  expect(table).toEqual(JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as TokenTable);
});
