/**
 * Hexly design-token ESLint rules (ADR-0020).
 *
 * The design tokens and Tailwind's theme are one source of truth: every
 * utility-shaped token is declared in the `@theme` block (styles.css) or, for
 * the theme-variant / non-utility tokens, in tokens.css. These rules are the
 * load-bearing guard the ADR calls for — without them, aligning to Tailwind
 * silently *widens* the spacing vocabulary (every multiplier step becomes
 * reachable) and token typos fail silently (`var(--danger)` resolves to
 * nothing). stylelint can't help here: component styles are CSS-in-TS template
 * strings, so the check lives in ESLint over the string/template literals.
 *
 *   no-unknown-design-token — every `var(--…)` must resolve to a defined token
 *                             (or a private `--_…` component-local variable).
 *   no-off-scale-spacing    — spacing utilities (p-/m-/gap-/…) may only use the
 *                             curated steps; the multiplier fallback is fenced.
 *
 * The allowlist is read from styles.css + tokens.css at lint time, so the
 * curation lives in the CSS and these rules stay in sync automatically.
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILES = ['apps/web/src/styles.css', 'apps/web/src/styles/tokens.css'];

/** Tailwind built-ins a component may legitimately reference by name. */
const BUILTIN_TOKENS = ['spacing', 'radius', 'font-sans', 'font-serif', 'font-mono'];

/** Spacing/whitespace utility prefixes whose step must stay on the curated scale. */
const SPACING_PREFIXES = [
  'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y',
];
const SPACING_RE = new RegExp(`^-?(${SPACING_PREFIXES.join('|')})-(.+)$`);
/** Curated steps: px + 1–9 (declared in @theme), plus the universal 0/auto. */
const ON_SCALE_STEPS = new Set(['0', 'px', 'auto', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

let cachedTokens = null;
function loadTokens(cwd) {
  if (cachedTokens) return cachedTokens;
  const tokens = new Set(BUILTIN_TOKENS);
  // Find the repo root by walking up from cwd until the token files resolve.
  let base = cwd;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(base, TOKEN_FILES[0]))) break;
    const parent = path.dirname(base);
    if (parent === base) break;
    base = parent;
  }
  for (const rel of TOKEN_FILES) {
    try {
      const txt = fs.readFileSync(path.join(base, rel), 'utf8');
      for (const m of txt.matchAll(/--([a-z0-9][a-z0-9-]*)\s*:/g)) tokens.add(m[1]);
    } catch {
      /* token file not found from this cwd — fall back to builtins only */
    }
  }
  cachedTokens = tokens;
  return tokens;
}

/** Pull the raw text out of a string Literal or a TemplateLiteral node. */
function textOf(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.raw).join(' ');
  return null;
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
    const tokens = loadTokens(context.cwd ?? process.cwd());
    function check(node) {
      const text = textOf(node);
      if (!text || !text.includes('var(--')) return;
      for (const m of text.matchAll(/var\(\s*--([a-z0-9_-]+)\s*[,)]/g)) {
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

const noOffScaleSpacing = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow off-scale Tailwind spacing utilities; keep the curated scale (ADR-0020).' },
    schema: [],
    messages: {
      offScale:
        'Off-scale spacing utility `{{cls}}`. Hexly\'s spacing scale is curated (steps px, 1–9); use an on-scale step, an arbitrary `[…]` value, or var(--spacing-N) (ADR-0020).',
    },
  },
  create(context) {
    function check(node) {
      const text = textOf(node);
      if (!text) return;
      // Tokenise like HTML/class text so only standalone class tokens are tested;
      // CSS such as `var(--spacing-2)` never yields a bare `p-2` token.
      for (const tok of text.split(/[\s"'`=<>(){}[\],;:]+/)) {
        const m = SPACING_RE.exec(tok);
        if (!m) continue;
        const step = m[2];
        if (step.startsWith('[')) continue; // explicit arbitrary value — intentional opt-out
        if (!ON_SCALE_STEPS.has(step)) {
          context.report({ node, messageId: 'offScale', data: { cls: tok } });
        }
      }
    }
    return { TemplateLiteral: check };
  },
};

export default {
  rules: {
    'no-unknown-design-token': noUnknownDesignToken,
    'no-off-scale-spacing': noOffScaleSpacing,
  },
};
