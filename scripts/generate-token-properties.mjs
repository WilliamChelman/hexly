// @ts-check
/**
 * Rewrite the `@property` registration block from the design-token manifest (ADR-0075) — the block is
 * generated, never maintained beside the manifest. The output is committed rather than produced during
 * the build, so the stylesheet stays a plain `@import` that both the app bundle and every scoped
 * component's `@reference` can read; `property-block.spec.ts` fails the build if the two drift.
 *
 * jiti loads the TS manifest with no build step, the same route the lint rule takes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { format, resolveConfig } from 'prettier';

const repoRoot = resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);

/** @type {typeof import('../libs/web-styles/src/tokens/property-block.js')} */
const { designTokenPropertyBlock, withDesignTokenAllowlist, DESIGN_TOKEN_PROPERTIES_PATH, PRE_PAINT_REPLAY_PATH } =
  await jiti.import(resolve(repoRoot, 'libs/web-styles/src/tokens/property-block.ts'));

/** Written through Prettier so `--check` and the drift specs agree with the generator by construction. */
async function write(path, contents) {
  const file = resolve(repoRoot, path);
  const options = await resolveConfig(file);
  writeFileSync(file, await format(contents, { ...options, filepath: file }), 'utf8');
  console.log(`✓ wrote ${path}`);
}

await write(DESIGN_TOKEN_PROPERTIES_PATH, designTokenPropertyBlock());
await write(
  PRE_PAINT_REPLAY_PATH,
  withDesignTokenAllowlist(readFileSync(resolve(repoRoot, PRE_PAINT_REPLAY_PATH), 'utf8')),
);
