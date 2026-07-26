/**
 * Hexly design-token ESLint rules (ADR-0020).
 *
 * no-unknown-design-token — every `var(--…)` must resolve to a token defined in
 * web-styles/index.css or tokens.css (or a private `--_…` component-local variable).
 * A token typo fails silently in CSS (`var(--danger)` resolves to nothing), and
 * stylelint can't see it: component styles are CSS-in-TS template strings, so the
 * check runs in ESLint over string/template literals.
 *
 * The allowlist is read from the CSS files at lint time.
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILES = ['libs/web-styles/src/index.css', 'libs/web-styles/src/tokens.css'];

/**
 * Tailwind built-ins a component may reference by name. `--spacing` is the base unit
 * of Tailwind's default scale — scoped styles spell a spacing value `calc(var(--spacing) * N)`
 * (ADR-0030) — and is the only spacing var, so it can't be a typo for anything. `--radius`
 * stays off the list: @theme declares explicit `--radius-*` keys, so a bare `var(--radius)`
 * resolves to nothing and must still be flagged.
 */
const BUILTIN_TOKENS = ['font-sans', 'font-serif', 'font-mono', 'spacing'];

let cache = null;
/**
 * Read the token set + shadow utilities from the CSS files.
 *
 * The cache is keyed by file mtimes, so a long-lived ESLint server / Nx daemon picks up
 * a new or renamed token without a restart. A load that read *no* file is never cached:
 * one early call from a cwd whose walk-up misses the repo would otherwise poison every
 * later file with a builtins-only set and fail the lint on false positives.
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
      // respect the [data-color-scheme] reassignment — Tailwind's built-ins bake a
      // Solar value (ADR-0021).
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
 * Raw text of a string Literal or TemplateLiteral node, with CSS block comments stripped:
 * a comment word like "shadow" or a `var(--…)` shown in an example would otherwise trip
 * the token/shadow scans. Class names never live in comments, so the drop is safe.
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
    docs: {
      description: 'Disallow var(--…) references to undefined design tokens (ADR-0020).',
    },
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
    docs: {
      description:
        "Disallow Tailwind built-in shadow-* utilities; use the project's shadow-1/2/3/inset tokens (ADR-0021).",
    },
    schema: [],
    messages: {
      builtin:
        'Built-in shadow utility `{{cls}}` bakes a Solar value and ignores [data-color-scheme]. Use shadow-1, shadow-2, shadow-3, or shadow-inset instead (ADR-0021).',
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
          !!p && p.type === 'Property' && p.value === node && (p.key.name === 'class' || p.key.value === 'class');
        if (isClassProp || node.value.includes('class=')) {
          const t = textOf(node);
          if (t) scan(node, t);
        }
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
