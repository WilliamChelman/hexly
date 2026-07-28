import { DesignToken, isDesignToken } from './manifest';

/**
 * What the stylesheets *say* a token is — the expression, before an engine resolves it.
 *
 * Read from the CSSOM rather than restated in the manifest: the declaration **is** the derivation, and
 * a second copy of it beside the values is a second thing to drift (ADR-0075). The manifest declares
 * who is in the contract and what type each token holds; this answers where a value comes from, which
 * is the one question `measureScheme` cannot — it hands back what resolved, never why.
 */

/** A token's declaration, verbatim; absent for a token no reachable stylesheet declares. */
export type DeclaredTokens = Readonly<Partial<Record<DesignToken, string>>>;

/** How a token gets its value, as its own declaration alone tells it. */
export interface TokenDerivation {
  /**
   * `derived` — an expression over tier 1; `anchor` — one tier-1 token under another name; `literal` —
   * a value stated outright, which no anchor reaches.
   */
  readonly kind: 'derived' | 'anchor' | 'literal';
  /** The tokens the expression reads, in first-mention order; empty for a literal. */
  readonly sources: readonly DesignToken[];
  /** The declaration itself, whitespace collapsed. */
  readonly formula: string;
}

/** A whole declaration that is one `var()` and nothing else — the token is that other token. */
const ALIAS = /^var\(\s*(--[a-z0-9-]+)\s*\)$/;

/**
 * The colour primitives a derivation is written in. A `linear-gradient()` naming its two stops is not
 * one of them: it is exactly what it says, which is why the sheen gradients are not settable at all.
 */
const PRIMITIVES = /oklch\(\s*from|color-mix\(|contrast-color\(/;

const REFERENCE = /var\(\s*(--[a-z0-9-]+)/g;

/**
 * Whitespace inside a CSS value is free, and every engine re-serialises it differently — so one shape,
 * both to match on and to show. Padding inside brackets goes; the spaces between arguments stay, being
 * what makes a long derivation readable at all.
 */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

/**
 * Where `declaration` gets its value. Total: a declaration this cannot read as an expression is a
 * literal, which is the honest answer for one and the safe answer for anything new.
 */
export function tokenDerivation(declaration: string): TokenDerivation {
  const formula = collapse(declaration);
  const sources = [...new Set([...formula.matchAll(REFERENCE)].map(([, name]) => name))].filter(isDesignToken);
  if (ALIAS.test(formula)) return { kind: 'anchor', sources, formula };
  const derived = PRIMITIVES.test(formula) || sources.some((name) => name.startsWith('--palette-'));
  return { kind: derived ? 'derived' : 'literal', sources, formula };
}

/**
 * Every rule that declares custom properties for `scheme`, most specific first — a rule naming the
 * ColorScheme outright beats one at the root, which is the cascade the engine applies too.
 *
 * `@supports` blocks are skipped whole. Tailwind lowers each `@property` into one, re-declaring every
 * registered token at `:root` as its `initial-value` for engines without Properties & Values — a
 * literal restatement of the very expression this is here to read (ADR-0075).
 */
function* declaringRules(rules: CSSRuleList, scheme: string): Generator<CSSStyleRule> {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSSupportsRule) continue;
    if (rule instanceof CSSStyleRule && appliesTo(rule.selectorText, scheme)) yield rule;
    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested) yield* declaringRules(nested, scheme);
  }
}

/**
 * Whether a rule speaks for one ColorScheme rather than both. The attribute, not `:root`, is what
 * separates them — since ADR-0077 every Palette is declared at the root.
 */
function namesAScheme(selectorText: string): boolean {
  return selectorText.includes('[data-color-scheme=');
}

/** Whether any selector in the list dresses the root as `scheme` — a Palette is declared there alone. */
function appliesTo(selectorText: string, scheme: string): boolean {
  return selectorText
    .split(',')
    .some((one) => (namesAScheme(one) ? one.includes(`[data-color-scheme="${scheme}"]`) : /:root|:host/.test(one)));
}

/**
 * Every declared token, as `scheme` declares it. The first declaration wins, matching the order the
 * stylesheets are written in: the derivation at `:root` comes before Tailwind's own restatement of the
 * resolved value, and a ColorScheme that reassigns a token does so after the root has declared it —
 * so `dark` is read by taking its block's own declaration where there is one.
 *
 * `{}` where no stylesheet is reachable, which is jsdom and a cross-origin sheet alike.
 */
export function declaredTokenValues(scheme: string): DeclaredTokens {
  const scoped: Record<string, string> = {};
  const root: Record<string, string> = {};
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet declares no token of ours; it cannot be read, and must not throw here.
      continue;
    }
    for (const rule of declaringRules(rules, scheme)) {
      const into = namesAScheme(rule.selectorText) ? scoped : root;
      for (const name of Array.from(rule.style)) {
        if (!isDesignToken(name) || name in into) continue;
        into[name] = collapse(rule.style.getPropertyValue(name));
      }
    }
  }
  return { ...root, ...scoped };
}
