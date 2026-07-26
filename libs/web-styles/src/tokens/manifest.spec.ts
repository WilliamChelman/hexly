import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS, designToken, isDesignToken } from './manifest';

/**
 * The manifest declares the contract; `index.css` and `tokens.css` still hold the values. These tests
 * are the join: a token added to the CSS without a declaration — or declared with an `initial` that no
 * longer matches its Solar value — fails here rather than quietly leaving the contract incomplete
 * (ADR-0075, "A manifest is the single source of the contract").
 */

/** Every custom property declared in a stylesheet, first declaration wins — which is the Solar one. */
function declaredTokens(...files: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of files) {
    const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const names = /(--[a-z0-9][a-z0-9-]*)\s*:/g;
    for (let match = names.exec(css); match; match = names.exec(css)) {
      // Read to the declaration's own `;`, ignoring the ones nested inside `rgba(…)` / `cubic-bezier(…)`.
      let depth = 0;
      let end = names.lastIndex;
      for (; end < css.length; end++) {
        const char = css[end];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if ((char === ';' || char === '}') && depth === 0) break;
      }
      if (!found.has(match[1])) found.set(match[1], canonical(css.slice(names.lastIndex, end)));
    }
  }
  return found;
}

/** Whitespace inside a CSS value is free — compare the shape, not the line breaks the formatter chose. */
function canonical(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();
}

const declared = declaredTokens('../index.css', '../tokens.css');

describe('the design-token manifest', () => {
  it('declares every token the stylesheets define, and nothing they do not', () => {
    expect(new Set(DESIGN_TOKENS.map((decl) => decl.name))).toEqual(new Set(declared.keys()));
  });

  it("carries each token's Solar value as its initial", () => {
    const drifted = DESIGN_TOKENS.filter((decl) => canonical(decl.initial) !== declared.get(decl.name));
    expect(drifted.map((decl) => decl.name)).toEqual([]);
  });

  it('keeps the type scale, the layout rails, and motion out of the public contract', () => {
    const outOfContract = DESIGN_TOKENS.filter((decl) =>
      /^--(text|leading|tracking|font-weight|rail|container|dur|ease)-/.test(decl.name),
    );
    expect(outOfContract.every((decl) => !decl.public)).toBe(true);
    expect(outOfContract).not.toHaveLength(0);
  });

  it('names the owning plugin of every tier-3 token, and only those', () => {
    for (const decl of DESIGN_TOKENS) {
      expect(decl.owner === undefined).toBe(decl.tier !== 'plugin');
    }
  });

  it('recognises a declared token and rejects a typo', () => {
    expect(isDesignToken('--color-accent')).toBe(true);
    expect(isDesignToken('--color-acccent')).toBe(false);
    expect(designToken('--color-accent')?.tier).toBe('role');
    expect(designToken('--color-acccent')).toBeUndefined();
  });
});
