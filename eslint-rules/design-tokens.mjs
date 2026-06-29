/**
 * Hexly design-token ESLint rules (ADR-0020).
 *
 * The design tokens and Tailwind's theme are one source of truth: every
 * utility-shaped token is declared in the `@theme` block (styles.css) or, for
 * the theme-variant / non-utility tokens, in tokens.css. These rules are the
 * load-bearing guard the ADR calls for — without it, token typos fail silently
 * (`var(--danger)` resolves to nothing). stylelint can't help here: component
 * styles are CSS-in-TS template strings, so the check lives in ESLint over the
 * string/template literals.
 *
 *   no-unknown-design-token — every `var(--…)` must resolve to a defined token
 *                             (or a private `--_…` component-local variable).
 *
 * Spacing is no longer fenced: ADR-0030 reverted the bespoke `--spacing-1..9`
 * scale to Tailwind's default linear multiplier, so every step is intentionally
 * open and `no-off-scale-spacing` was removed.
 *
 * The token allowlist is read from styles.css + tokens.css at lint time, so the
 * curation lives in the CSS and this rule stays in sync automatically.
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILES = ['apps/web/src/styles.css', 'apps/web/src/styles/tokens.css'];

/**
 * Tailwind built-ins a component may legitimately reference by name. `--spacing`
 * is the base unit of Tailwind's default scale — scoped styles take a spacing
 * value as `calc(var(--spacing) * N)` (ADR-0030). It's allowlisted because with
 * the bespoke `--spacing-N` keys gone it's the *only* spacing var, so there's no
 * `--spacing-N` it could be a silent typo for. `--radius` stays off the list:
 * the @theme still declares explicit `--radius-*` keys, so a bare `var(--radius)`
 * would resolve to nothing and must still be flagged.
 */
const BUILTIN_TOKENS = ['font-sans', 'font-serif', 'font-mono', 'spacing'];

let cache = null;
/**
 * Read the curated token set + shadow utilities from the CSS source of truth.
 *
 * Returns `{ sig, tokens, shadowUtilities }`. The cache is keyed by the resolved
 * file mtimes, so editing a token file invalidates it — a long-lived ESLint
 * server / Nx daemon picks up a new or renamed token without a restart. A load
 * that managed to read *no* file is deliberately NOT cached: otherwise a single
 * early call from a cwd whose walk-up can't reach the repo would poison every
 * later file with a builtins-only set and fail the whole lint on false
 * positives (`var(--color-ink)` & co. reported "unknown").
 */
function loadCss(cwd) {
  // Find the repo root by walking up from cwd until the token files resolve.
  let base = cwd;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(base, TOKEN_FILES[0]))) break;
    const parent = path.dirname(base);
    if (parent === base) break;
    base = parent;
  }
  const sig =
    base +
    '|' +
    TOKEN_FILES.map((rel) => {
      try {
        return `${rel}:${fs.statSync(path.join(base, rel)).mtimeMs}`;
      } catch {
        return `${rel}:none`;
      }
    }).join('|');
  if (cache && cache.sig === sig) return cache;

  const tokens = new Set(BUILTIN_TOKENS);
  const shadowUtilities = new Set();
  let readAny = false;
  for (const rel of TOKEN_FILES) {
    try {
      const txt = fs.readFileSync(path.join(base, rel), 'utf8');
      readAny = true;
      for (const m of txt.matchAll(/--([a-z0-9][a-z0-9-]*)\s*:/g)) tokens.add(m[1]);
      // Shadow utilities are the `@utility shadow-*` declarations; only these
      // respect the [data-theme] reassignment — Tailwind's built-ins bake a
      // light-mode value (ADR-0021).
      for (const m of txt.matchAll(/@utility\s+(shadow-[a-z0-9-]+)/g)) shadowUtilities.add(m[1]);
    } catch {
      /* token file not found from this cwd */
    }
  }
  const result = { sig, tokens, shadowUtilities };
  if (readAny) cache = result; // never cache a total-failure load (avoids poisoning)
  return result;
}

/**
 * Pull the raw text out of a string Literal or a TemplateLiteral node, with CSS
 * block comments stripped. CSS-in-TS `styles` are full of prose comments; once
 * primitives carry `@apply` blocks (ADR-0031) a comment word like "shadow" or a
 * `var(--…)` shown in an example would otherwise trip the token/shadow scans.
 * Class names never live in comments, so dropping `/* … *​/` spans is safe.
 */
function textOf(node) {
  let text = null;
  if (node.type === 'Literal') text = typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral') text = node.quasis.map((q) => q.value.raw).join(' ');
  return text === null ? null : text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const noUnknownDesignToken = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow var(--…) references to undefined design tokens (ADR-0020).' },
    schema: [],
    messages: {
      unknown:
        'Unknown design token `var(--{{name}})`. Reference a token defined in the @theme block (styles.css) or tokens.css, or a private `--_…` variable (ADR-0020).',
    },
  },
  create(context) {
    const { tokens } = loadCss(context.cwd ?? process.cwd());
    function check(node) {
      const text = textOf(node);
      if (!text || !text.includes('var(--')) return;
      // Capture uppercase letters too: CSS custom properties are case-sensitive,
      // so a typo'd `var(--Gold)` does not resolve to `--color-gold` and must
      // still be flagged rather than silently skipped by a lowercase-only match.
      for (const m of text.matchAll(/var\(\s*--([A-Za-z0-9_-]+)\s*[,)]/g)) {
        const name = m[1];
        if (name.startsWith('_')) continue; // component-local indirection var
        if (!tokens.has(name)) {
          context.report({ node, messageId: 'unknown', data: { name } });
        }
      }
    }
    return { Literal: check, TemplateLiteral: check };
  },
};

const noBuiltinShadow = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Tailwind built-in shadow-* utilities; use the project\'s shadow-1/2/3/inset tokens (ADR-0021).' },
    schema: [],
    messages: {
      builtin:
        'Built-in shadow utility `{{cls}}` bakes a light-mode value and ignores [data-theme]. Use shadow-1, shadow-2, shadow-3, or shadow-inset instead (ADR-0021).',
    },
  },
  create(context) {
    const { shadowUtilities } = loadCss(context.cwd ?? process.cwd());
    function scan(node, text) {
      for (const tok of text.split(/[\s"'`=<>(){},;:]+/)) {
        if (!tok.startsWith('shadow-') && tok !== 'shadow') continue;
        if (tok.includes('[')) continue; // explicit arbitrary value — intentional opt-out
        if (tok === 'shadow-none') continue; // no shadow at all — nothing themeable to bake
        if (!shadowUtilities.has(tok)) {
          context.report({ node, messageId: 'builtin', data: { cls: tok } });
        }
      }
    }
    return {
      TemplateLiteral(node) {
        const text = textOf(node);
        if (text) scan(node, text);
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const p = node.parent;
        const isClassProp =
          !!p &&
          p.type === 'Property' &&
          p.value === node &&
          (p.key.name === 'class' || p.key.value === 'class');
        if (isClassProp || node.value.includes('class=')) scan(node, node.value);
      },
    };
  },
};

export default {
  rules: {
    'no-unknown-design-token': noUnknownDesignToken,
    'no-builtin-shadow': noBuiltinShadow,
  },
};
