// @ts-check
/**
 * Rewrite what the design-token contract generates rather than maintains: the `@property` registration
 * block and the pre-paint allowlist from the manifest (ADR-0075/ADR-0076), and `tokens.css`'s tier-1
 * regions from the Palette Preset table (ADR-0077). The output is committed rather than produced during
 * the build, so the stylesheet stays a plain `@import` that both the app bundle and every scoped
 * component's `@reference` can read; `property-block.spec.ts` and `palette-block.spec.ts` fail the build
 * if any of them drift.
 *
 * jiti loads the TS sources with no build step, the same route the lint rule takes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { format, resolveConfig } from 'prettier';

const repoRoot = resolve(import.meta.dirname, '..');
/** `libs/domain` reaches the manifest by package name, which nothing in `node_modules` resolves. */
const jiti = createJiti(import.meta.url, {
  alias: { '@hexly/web-styles': resolve(repoRoot, 'libs/web-styles/src/index.ts') },
});

/** @type {typeof import('../libs/web-styles/src/tokens/property-block.js')} */
const { designTokenPropertyBlock, withDesignTokenAllowlist, DESIGN_TOKEN_PROPERTIES_PATH, PRE_PAINT_REPLAY_PATH } =
  await jiti.import(resolve(repoRoot, 'libs/web-styles/src/tokens/property-block.ts'));

/** @type {typeof import('../libs/domain/src/lib/palette-block.js')} */
const { withPalettePresetRegions, TOKENS_STYLESHEET_PATH } = await jiti.import(
  resolve(repoRoot, 'libs/domain/src/lib/palette-block.ts'),
);

/** Written through Prettier so `--check` and the drift specs agree with the generator by construction. */
async function write(path, contents) {
  const file = resolve(repoRoot, path);
  const options = await resolveConfig(file);
  writeFileSync(file, await format(contents, { ...options, filepath: file }), 'utf8');
  console.log(`✓ wrote ${path}`);
}

/** A generator that splices into its own output, so the fences stay where the file put them. */
async function rewrite(path, splice) {
  await write(path, splice(readFileSync(resolve(repoRoot, path), 'utf8')));
}

await write(DESIGN_TOKEN_PROPERTIES_PATH, designTokenPropertyBlock());
await rewrite(PRE_PAINT_REPLAY_PATH, withDesignTokenAllowlist);
await rewrite(TOKENS_STYLESHEET_PATH, withPalettePresetRegions);
