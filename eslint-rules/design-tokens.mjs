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
 * The allowlist *and* the curated spacing scale are both read from styles.css +
 * tokens.css at lint time, so the curation lives in the CSS and these rules
 * stay in sync automatically (add a `--spacing-10` key and `p-10` is allowed;
 * remove `--spacing-9` and `p-9` is rejected — no edit here required).
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILES = ['apps/web/src/styles.css', 'apps/web/src/styles/tokens.css'];

/**
 * Tailwind built-ins a component may legitimately reference by name. Only names
 * Tailwind actually emits as a `--…` custom property belong here: bare
 * `--spacing` / `--radius` are NOT emitted once the @theme declares explicit
 * `--spacing-N` / `--radius-*` keys, so allowlisting them would let a typo like
 * `var(--spacing)` (meant `--spacing-4`) resolve to nothing yet pass the rule.
 */
const BUILTIN_TOKENS = ['font-sans', 'font-serif', 'font-mono'];

/** Spacing/whitespace utility prefixes whose step must stay on the curated scale. */
const SPACING_PREFIXES = [
  'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y',
];
// Longest prefix first so `gap-x-2` matches `gap-x` (step `2`), not `gap` (step
// `x-2`): JS alternation takes the first branch that lets the overall match
// succeed, and a bare `gap` + `-(.+)` would otherwise swallow `x-2` as the step
// and flag a perfectly valid utility as off-scale.
const SPACING_RE = new RegExp(
  `^-?(${[...SPACING_PREFIXES].sort((a, b) => b.length - a.length).join('|')})-(.+)$`,
);
/** Steps always valid regardless of the curated scale (Tailwind universals). */
const UNIVERSAL_STEPS = ['0', 'auto'];

let cache = null;
/**
 * Read the curated token set + spacing scale from the CSS source of truth.
 *
 * Returns `{ sig, tokens, spacingSteps }`. The cache is keyed by the resolved
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
  const spacingSteps = new Set(UNIVERSAL_STEPS);
  let readAny = false;
  for (const rel of TOKEN_FILES) {
    try {
      const txt = fs.readFileSync(path.join(base, rel), 'utf8');
      readAny = true;
      for (const m of txt.matchAll(/--([a-z0-9][a-z0-9-]*)\s*:/g)) tokens.add(m[1]);
      // The curated spacing scale *is* whatever `--spacing-<step>` keys exist,
      // so the off-scale rule tracks the @theme instead of a hardcoded list.
      for (const m of txt.matchAll(/--spacing-([a-z0-9]+)\s*:/g)) spacingSteps.add(m[1]);
    } catch {
      /* token file not found from this cwd */
    }
  }
  const result = { sig, tokens, spacingSteps };
  if (readAny) cache = result; // never cache a total-failure load (avoids poisoning)
  return result;
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
    const { spacingSteps } = loadCss(context.cwd ?? process.cwd());
    function scan(node, text) {
      // Tokenise like HTML/class text so only standalone class tokens are tested;
      // CSS such as `var(--spacing-2)` never yields a bare `p-2` token. Brackets
      // are deliberately NOT delimiters, so an arbitrary value stays one token
      // (`p-[10px]`) and is recognised by the `[`-step opt-out below.
      for (const tok of text.split(/[\s"'`=<>(){},;:]+/)) {
        const m = SPACING_RE.exec(tok);
        if (!m) continue;
        const step = m[2];
        if (step.startsWith('[')) continue; // explicit arbitrary value — intentional opt-out
        if (!spacingSteps.has(step)) {
          context.report({ node, messageId: 'offScale', data: { cls: tok } });
        }
      }
    }
    return {
      // Angular inline templates are template literals full of class attributes.
      TemplateLiteral(node) {
        const text = textOf(node);
        if (text) scan(node, text);
      },
      // Plain string class lists too — notably `host: { class: '…' }` (ADR-0020's
      // composite-shell allowance) and inline `class="…"` markup strings — but
      // NOT every unrelated string literal, which would flag e.g. a `pt-BR`
      // locale as off-scale `pt` spacing.
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
    'no-off-scale-spacing': noOffScaleSpacing,
  },
};
