// @ts-check
/**
 * Rewrite the `@property` registration block from the design-token manifest (ADR-0075) — the block is
 * generated, never maintained beside the manifest. The output is committed rather than produced during
 * the build, so the stylesheet stays a plain `@import` that both the app bundle and every scoped
 * component's `@reference` can read; `property-block.spec.ts` fails the build if the two drift.
 *
 * jiti loads the TS manifest with no build step, the same route the lint rule takes.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

const repoRoot = resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);

/** @type {typeof import('../libs/web-styles/src/tokens/property-block.js')} */
const { designTokenPropertyBlock, DESIGN_TOKEN_PROPERTIES_PATH } = await jiti.import(
  resolve(repoRoot, 'libs/web-styles/src/tokens/property-block.ts'),
);

const out = resolve(repoRoot, DESIGN_TOKEN_PROPERTIES_PATH);
writeFileSync(out, designTokenPropertyBlock(), 'utf8');
console.log(`✓ wrote ${DESIGN_TOKEN_PROPERTIES_PATH}`);
