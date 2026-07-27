import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DESIGN_TOKENS, DesignToken, measureScheme, registeredTokens, TokenType } from '@hexly/web-styles';
import { expect, preferencesPatched, test } from './fixtures';

/**
 * The token snapshot (ADR-0075, world-theme-spec §7): every declared token's resolved value, in both
 * ColorSchemes, against the committed table at {@link TABLE_PATH}.
 *
 * Resolved values, never how a token is spelled — asserting the expressions would freeze the formulas
 * the table exists to protect. Astral is pinned only here: `@property` allows one initial-value, so the
 * initial check below can only reach Solar, and a polarity sign error is invisible in that scheme.
 *
 * `UPDATE_TOKEN_TABLE=1` rewrites the table; read the diff rather than waving it through.
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

/** The declared tokens, in the order the manifest lists them. */
const TOKEN_NAMES = DESIGN_TOKENS.map((decl) => decl.name);

/** What the document resolves each token to, exactly as the Canvas renderers read them (ADR-0075). */
function resolve(page: Page, names: readonly DesignToken[]): Promise<Record<string, string>> {
  return page.evaluate((tokens) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(tokens.map((name) => [name, style.getPropertyValue(name).trim()]));
  }, names as string[]);
}

/**
 * Each CSS colour as a 2D drawing context rasterises it — 8-bit RGBA, whatever syntax it was written
 * in. That is both the comparison a hex and an `oklch()` can share and the exact parse the Canvas
 * renderers make (`graph-palette.ts`), so a colour neither form parses fails here rather than there.
 */
function rasterise(page: Page, values: readonly string[]): Promise<number[][]> {
  return page.evaluate((colors) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    return colors.map((value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000000';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    });
  }, values as string[]);
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

  const observed = {} as Record<ColorScheme, Record<string, string>>;
  try {
    for (const scheme of COLOR_SCHEMES) {
      await chooseColorScheme(page, scheme);
      observed[scheme] = await resolve(page, TOKEN_NAMES);
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
    TOKEN_NAMES.map((name) => [name, { solar: observed.solar[name], astral: observed.astral[name] }]),
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

  // The manifest carries each colour token's Solar value as its `@property` initial-value, and for a
  // derived one that is the value its expression *resolves to* — which no static reader can compute,
  // so `manifest.spec.ts` can only check it is a literal. This is where it is held to the engine: the
  // initial is the fallback three Canvas renderers take when a property fails to resolve (ADR-0075),
  // and a stale one is a second, silently wrong copy of the palette.
  const colors = registeredTokens().filter((decl) => decl.type === 'color');
  const [resolved, initials] = await Promise.all([
    rasterise(
      page,
      colors.map((decl) => table[decl.name].solar),
    ),
    rasterise(
      page,
      colors.map((decl) => decl.initial),
    ),
  ]);
  // One 8-bit step of slack: an `oklch()` rounds to the same channel a hand-written hex names, but
  // only to within the rounding itself.
  const drifted = colors.filter((_, i) => resolved[i].some((channel, c) => Math.abs(channel - initials[i][c]) > 1));
  expect(
    drifted.map((decl) => decl.name),
    "every colour token's manifest initial is the value it resolves to in Solar",
  ).toEqual([]);

  // Rewritten only once the values above are known to be resolved, so a reflexive regenerate cannot
  // commit a table of raw declarations.
  if (process.env.UPDATE_TOKEN_TABLE === '1' && !process.env.CI) {
    writeFileSync(TABLE_PATH, `${JSON.stringify(table, null, 2)}\n`);
  }

  expect(table).toEqual(JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as TokenTable);
});

test('the contrast report measures the ColorScheme the reader is not in, roles included', async ({ page }) => {
  // The committed table, not a second reading of the same root: an oracle that shares no machinery with
  // the detached subtree it judges, and that a bug in `collect` cannot move to match.
  const table = JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as TokenTable;

  await page.goto('/settings');
  // Same reason as `collect`: the ColorScheme roams and hydrates when `/auth/me` resolves (ADR-0038).
  await expect(page.getByTestId('email')).not.toBeEmpty();

  try {
    // Both directions, because the reader's own scheme is what the probe has to *not* return, and a
    // measurement that quietly read the root would pass one direction on a Palette where the two agree.
    for (const active of COLOR_SCHEMES) {
      const inactive = active === 'solar' ? 'astral' : 'solar';
      await chooseColorScheme(page, active);

      // A tier-2 override, inline on the root, standing in for the one the applier writes there for the
      // *active* scheme. Left in place it would be inherited by the scheme being measured, so the report
      // for one Palette would carry the other's opt-outs — which is why `declarations` replaces what is
      // inline rather than layering over it (ADR-0076).
      await page.evaluate(() => document.documentElement.style.setProperty('--color-bg', 'rgb(1, 2, 3)'));
      const inlineBefore = await page.evaluate(() => document.documentElement.getAttribute('style'));

      // The editor's own measurement, handed to the browser rather than restated here: what only an
      // engine can answer is this call, and `contrast.spec.ts` covers the judging that reads its result.
      const measured = await page.evaluate(measureScheme, { scheme: inactive, declarations: {}, tokens: TOKEN_NAMES });

      // Every declared token, exactly as the *other* ColorScheme renders it — the tier-2 roles included,
      // which is the half an offscreen probe silently gets wrong (see `world-theme.spec.ts`).
      expect(measured, `the report for ${inactive} while reading ${active}`).toEqual(
        Object.fromEntries(TOKEN_NAMES.map((name) => [name, table[name][inactive]])),
      );

      // What the document is still painting is the *active* scheme's answer — the override included,
      // since that is what an inline property does.
      expect(await resolve(page, ['--color-bg', '--color-ink'])).toEqual({
        '--color-bg': 'rgb(1, 2, 3)',
        '--color-ink': table['--color-ink'][active],
      });
      expect(measured['--color-bg']).not.toBe(table['--color-bg'][active]);

      // The root is measured on and put straight back inside one task — no paint happens inside a task,
      // so the reader never glimpses the ColorScheme they are not in, and nothing outlives the reading.
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', active);
      expect(await page.evaluate(() => document.documentElement.getAttribute('style'))).toBe(inlineBefore);

      await page.evaluate(() => document.documentElement.style.removeProperty('--color-bg'));
    }
  } finally {
    // As in `collect`: the preference roams on the shared e2e account, so hand back what we borrowed.
    const restored = preferencesPatched(page);
    await chooseColorScheme(page, 'solar');
    await restored;
  }
});
