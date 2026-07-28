import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS, SETTABLE_TOKENS } from './manifest';
import {
  DESIGN_TOKEN_PROPERTIES_PATH,
  GENERATE_COMMAND,
  PRE_PAINT_REPLAY_PATH,
  allowlistIn,
  designTokenPropertyBlock,
  SYNTAX,
  registeredTokens,
} from './property-block';

const repoRoot = new URL('../../../../', import.meta.url);
const committedAt = (path: string) => readFileSync(fileURLToPath(new URL(path, repoRoot)), 'utf8');

describe('the @property registration block', () => {
  it('is what the committed stylesheet holds', () => {
    const committed = committedAt(DESIGN_TOKEN_PROPERTIES_PATH);
    expect(committed, `the block is generated from the manifest — run \`${GENERATE_COMMAND}\``).toBe(
      designTokenPropertyBlock(),
    );
  });

  it('registers every colour, whichever tier owns it', () => {
    const colors = DESIGN_TOKENS.filter((decl) => decl.type === 'color');
    expect(registeredTokens()).toEqual(expect.arrayContaining([...colors]));
  });

  it('gives each registration an inherited syntax and an initial value', () => {
    const block = designTokenPropertyBlock();
    for (const decl of registeredTokens()) {
      expect(block).toContain(`@property ${decl.name} {`);
    }
    expect(block.match(/inherits: true;/g)).toHaveLength(registeredTokens().length);
    expect(block.match(/initial-value:/g)).toHaveLength(registeredTokens().length);
  });

  it('leaves the font-relative lengths unregistered, so they keep scaling with the text that uses them', () => {
    const names = registeredTokens().map((decl) => decl.name);
    expect(names).not.toContain('--tracking-wider');
    expect(names).not.toContain('--container-reading');
    expect(names).not.toContain('--text-base');
  });

  it('leaves out the types CSS has no @property syntax for', () => {
    const types = new Set(registeredTokens().map((decl) => decl.type));
    expect([...types].sort()).toEqual(['color', 'length', 'number', 'time']);
  });

  it('declares every unregisterable token as unregistered, rather than dropping it by its type', () => {
    // ADR-0075 asks for the exception to be declared. `registeredTokens` reads the flag alone, so an
    // unflagged shadow would reach the generator and register under `syntax: 'null'`.
    const undeclared = DESIGN_TOKENS.filter((decl) => SYNTAX[decl.type] === null && !decl.unregistered);
    expect(undeclared.map((decl) => decl.name)).toEqual([]);
  });

  it('fences the pre-paint replay on the tokens a Theme may set', () => {
    // The replay paints before Angular, so `declaredOnly` cannot reach it and this allowlist is the
    // only thing standing between untrusted cached JSON and the root (ADR-0076).
    const committed = allowlistIn(committedAt(PRE_PAINT_REPLAY_PATH));
    expect(committed, `the allowlist is generated from the manifest — run \`${GENERATE_COMMAND}\``).toEqual(
      SETTABLE_TOKENS.map((decl) => decl.name),
    );
  });

  it('keeps the gradients out of the replay, so no cached value can carry a url() to the page', () => {
    // Unregistered by type, so there is no `@property` syntax to discard a bad value: the fence is all
    // that refuses one, and the server's choke point already does (ADR-0076).
    const committed = allowlistIn(committedAt(PRE_PAINT_REPLAY_PATH));
    const gradients = DESIGN_TOKENS.filter((decl) => decl.type === 'gradient').map((decl) => decl.name);
    expect(gradients.length).toBeGreaterThan(0);
    expect(committed).toEqual(expect.not.arrayContaining(gradients));
  });

  it('admits the tier-1 Palette and the public roles, and nothing a Theme cannot write', () => {
    const names = SETTABLE_TOKENS.map((decl) => decl.name);
    // The anchors are private yet written: an Owner sets them as `light`/`dark`, not as overrides.
    expect(names).toEqual(expect.arrayContaining(['--palette-accent', '--palette-veil']));
    expect(names).toEqual(expect.arrayContaining(['--color-accent', '--radius-md', '--shadow-1', '--font-body']));
    expect(names).not.toContain('--text-base');
    expect(names).not.toContain('--dur-fast');
    expect(names).not.toContain('--color-terrain-grass');
  });

  it('never registers an initial value the engine would refuse', () => {
    // `initial-value` must be computationally independent, and a rule whose one is not is dropped
    // whole — the token reads back raw while the manifest still claims it is registered. A `var()` is
    // the loud form of that; a relative unit is the quiet one, which is how the `rem` type scale got in.
    const RELATIVE_UNIT = /\d(em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax)\b|%/;
    for (const decl of registeredTokens()) {
      expect(decl.initial, decl.name).not.toContain('var(');
      expect(decl.initial, decl.name).not.toMatch(RELATIVE_UNIT);
    }
  });
});
