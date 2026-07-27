import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS, designToken, isDesignToken } from './manifest';

/**
 * The manifest declares the contract; the stylesheets still hold the values. These tests are the
 * join: a token added to the CSS without a declaration — or declared with an `initial` that no longer
 * matches its Solar value — fails here rather than quietly leaving the contract incomplete (ADR-0075,
 * "A manifest is the single source of the contract").
 */

/** Every custom property declared in a stylesheet, first declaration wins — which is the Solar one. */
function declaredTokens(...files: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of files) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
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

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const LIBS = path('../../../');

/**
 * A plugin's tier-3 stylesheet, by owner id: `libs/plugin-<owner>-web/src/<owner>-tokens.css`. Found
 * by walking `libs/` rather than from a list, so the next plugin to declare a vocabulary is checked
 * against the owner the manifest names for it without editing these tests (ADR-0075). That such a
 * stylesheet is also *loaded* is `design-tokens.spec.ts`'s to prove — a token no sheet the app ships
 * declares reads back empty from a real engine.
 */
function pluginTokenFiles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(LIBS, { withFileTypes: true })) {
    const owner = /^plugin-(.+)-web$/.exec(entry.name)?.[1];
    if (!entry.isDirectory() || !owner) continue;
    const file = `${LIBS}${entry.name}/src/${owner}-tokens.css`;
    if (existsSync(file)) found.set(owner, file);
  }
  return found;
}

const core = declaredTokens(path('../index.css'), path('../tokens.css'));
const byPlugin = new Map([...pluginTokenFiles()].map(([owner, file]) => [owner, declaredTokens(file)] as const));
const declared = new Map([...core, ...[...byPlugin.values()].flatMap((tokens) => [...tokens])]);

describe('the design-token manifest', () => {
  it('declares every token the stylesheets define, and nothing they do not', () => {
    expect(new Set(DESIGN_TOKENS.map((decl) => decl.name))).toEqual(new Set(declared.keys()));
  });

  /**
   * Tier 3 is *owned*, and ownership is where the value is declared, not just what the manifest says:
   * core declaring a plugin's colour is the arrangement this tier exists to end, and one plugin
   * declaring another's is the same mistake pointing sideways.
   */
  it('leaves every tier-3 token to the plugin that owns it, and core the rest', () => {
    const owned = (owner: string) => DESIGN_TOKENS.filter((decl) => decl.owner === owner).map((decl) => decl.name);

    for (const [owner, tokens] of byPlugin) {
      expect([...tokens.keys()].sort(), `${owner} declares its own vocabulary, and only that`).toEqual(
        owned(owner).sort(),
      );
    }
    expect(
      [...core.keys()].filter((name) => designToken(name)?.tier === 'plugin'),
      'core declares no plugin vocabulary',
    ).toEqual([]);
  });

  /**
   * A token the stylesheets *compute* from another one, rather than state: an alias of an anchor, or a
   * colour function over one. A gradient naming its two stops is not one — it is exactly what it says.
   */
  function isDerived(name: string): boolean {
    const value = declared.get(name) ?? '';
    return /^var\(--palette-|oklch\(from|color-mix\(|contrast-color\(/.test(value);
  }

  it("carries each literal token's Solar value as its initial", () => {
    const drifted = DESIGN_TOKENS.filter(
      (decl) => !isDerived(decl.name) && canonical(decl.initial) !== declared.get(decl.name),
    );
    expect(drifted.map((decl) => decl.name)).toEqual([]);
  });

  /**
   * A derived token's initial is what its expression *resolves to* in Solar, which nothing outside an
   * engine can compute — `design-tokens.spec.ts` reads those values back from a real one. What is
   * checkable here is the constraint `@property` imposes: an `initial-value` carrying a `var()` is not
   * computationally independent, so the rule declaring it is dropped whole and the token silently
   * stops being registered (ADR-0075).
   */
  it('gives every derived token a computationally independent initial', () => {
    const derived = DESIGN_TOKENS.filter((decl) => isDerived(decl.name));
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.filter((decl) => decl.initial.includes('var(')).map((decl) => decl.name)).toEqual([]);
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
