import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS } from './manifest';
import {
  DESIGN_TOKEN_PROPERTIES_PATH,
  GENERATE_COMMAND,
  designTokenPropertyBlock,
  registeredTokens,
} from './property-block';

describe('the @property registration block', () => {
  it('is what the committed stylesheet holds', () => {
    const repoRoot = new URL('../../../../', import.meta.url);
    const committed = readFileSync(fileURLToPath(new URL(DESIGN_TOKEN_PROPERTIES_PATH, repoRoot)), 'utf8');
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
  });

  it('leaves out the types CSS has no @property syntax for', () => {
    const types = new Set(registeredTokens().map((decl) => decl.type));
    expect([...types].sort()).toEqual(['color', 'length', 'number', 'time']);
  });

  it('never registers an initial value that depends on another token', () => {
    // `initial-value` must be computationally independent: a `var()` in one is a parse error that
    // takes the whole registration — and every reader of that token — down with it.
    for (const decl of registeredTokens()) {
      expect(decl.initial).not.toContain('var(');
    }
  });
});
