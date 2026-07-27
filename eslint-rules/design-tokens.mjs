/**
 * Hexly design-token ESLint rules (ADR-0020, amended by ADR-0075).
 *
 * no-unknown-design-token — every `var(--…)` must resolve to a token the manifest declares
 * (or a private `--_…` variable), and must sit on the right side of the tier boundary. `--_` marks a
 * value outside the token contract, not one confined to a single component — a layout measurement a
 * page publishes for a descendant to read is still nothing a World Owner may set (ADR-0020).
 * A token typo fails silently in CSS (`var(--danger)` resolves to nothing), and
 * stylelint can't see it: component styles are CSS-in-TS template strings, so the check runs
 * in ESLint over string/template literals.
 *
 * The allowlist is the manifest, not a grep of the stylesheets: a token exists for the linter
 * exactly when it is declared, and the declaration also says which tier it belongs to (ADR-0075).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(REPO_ROOT, 'libs/web-styles/src/tokens/manifest.ts');
/**
 * Where `no-builtin-shadow`'s allowlist lives — the `@utility shadow-*` declarations. Moving or
 * renaming either file is a change here too: the read is unguarded, so it fails the lint by name
 * rather than quietly waving every built-in shadow through.
 */
const UTILITY_FILES = ['libs/web-styles/src/index.css', 'libs/web-styles/src/tokens.css'].map((rel) =>
  path.join(REPO_ROOT, rel),
);

/**
 * Tailwind built-ins a component may reference by name. Tailwind's own `@theme` declares them, not
 * the manifest — which carries only Hexly's contract, so `--font-mono` is on it and its `--font-sans`
 * / `--font-serif` siblings are not. `--spacing` is the base unit of Tailwind's default scale —
 * scoped styles spell a spacing value `calc(var(--spacing) * N)` (ADR-0030) — and is the only spacing
 * var, so it can't be a typo for anything. `--radius` stays off the list: @theme declares explicit
 * `--radius-*` keys, so a bare `var(--radius)` resolves to nothing and must still be flagged.
 */
const BUILTIN_TOKENS = new Set(['--font-sans', '--font-serif', '--spacing']);

/** A file's mtime, or `null` when it isn't there. */
function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Memoise `read()` until `stamp()` changes, so a long-lived ESLint server / Nx daemon picks up an
 * edited source without a restart. A read that throws is left to throw: every source below sits at a
 * path fixed relative to this file, so a failure means a broken checkout, and a silently empty
 * allowlist would fail every lint on false positives instead of saying why.
 */
function rereadOnChange(stamp, read) {
  let cache = null;
  return () => {
    const now = stamp();
    if (!cache || cache.stamp !== now) cache = { stamp: now, value: read() };
    return cache.value;
  };
}

/**
 * The token contract, by name. jiti loads the TS manifest with no build step — the route
 * `scripts/generate-token-properties.mjs` also takes — and a fresh instance each time is what makes
 * the reread a reread rather than a cache hit inside jiti.
 */
const loadManifest = rereadOnChange(
  () => mtime(MANIFEST),
  () => {
    const { DESIGN_TOKENS } = createJiti(import.meta.url, { moduleCache: false })(MANIFEST);
    return new Map(DESIGN_TOKENS.map((decl) => [decl.name, decl]));
  },
);

/**
 * The `@utility shadow-*` declarations; only these respect the [data-color-scheme] reassignment —
 * Tailwind's built-ins bake a Solar value (ADR-0021).
 */
const loadShadowUtilities = rereadOnChange(
  () => UTILITY_FILES.map(mtime).join('|'),
  () => {
    const utilities = new Set();
    for (const file of UTILITY_FILES) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/@utility\s+(shadow-[a-z0-9-]+)/g)) utilities.add(m[1]);
    }
    return utilities;
  },
);

/** Paths compare by `/`, whatever the platform wrote them with. */
function posix(filename) {
  return filename.replaceAll('\\', '/');
}

/**
 * The plugin whose tier-3 vocabulary this file may use — `libs/plugin-hexmap-web/…` is `hexmap`'s —
 * or `null` for core libs and the app, which own none. The id matches the manifest's `owner`.
 */
function owningPlugin(filename) {
  const match = /(?:^|\/)libs\/plugin-([a-z0-9-]+?)(?:-server|-web)?\//.exec(posix(filename));
  return match ? match[1] : null;
}

/**
 * The one file exempt from the tier gates: rendering every token in the system, anchors and plugin
 * vocabulary included, is what the styleguide is _for_. ADR-0075 draws the boundary and grants no
 * exemption; `docs/design/world-theme-spec.md` §4 names this one. Spelled as a path rather than as
 * suppression comments over the swatches, so the grant stays reviewable in one place and no lint
 * config can hand it to anyone else.
 */
const STYLEGUIDE = 'apps/web/src/app/pages/styleguide/';

/**
 * Why a `var(--…)` reference is not allowed from this file, or `null` when it is fine.
 *
 * An undeclared name is a typo first and a tier breach second — including in the styleguide, which
 * is exempt from the boundary but not from the manifest: a token it renders still has to exist.
 * Past that, `--palette-*` is tier 1 by convention as well as by manifest (ADR-0075), so an anchor
 * reference is named as the layering mistake it is from the first one written.
 */
function disallowedReason(name, decl, filename) {
  const everyTier = posix(filename).includes(STYLEGUIDE);
  if (!decl) return !everyTier && name.startsWith('--palette-') ? 'palette' : 'unknown';
  if (everyTier) return null;
  if (decl.tier === 'palette') return 'palette';
  if (decl.tier === 'plugin' && decl.owner !== owningPlugin(filename)) return 'foreign';
  return null;
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
      description:
        "Disallow var(--…) references to undeclared design tokens, to Palette anchors, and to another plugin's tier-3 tokens (ADR-0075).",
    },
    schema: [],
    messages: {
      unknown:
        'Unknown design token `var({{name}})`. Reference a token declared in libs/web-styles/src/tokens/manifest.ts, or a private `--_…` variable (ADR-0075).',
      palette:
        'Private Palette anchor `var({{name}})`. Tier 1 belongs to the derivation: style from the semantic role derived from the anchor, so re-theming stays a change to the anchors alone (ADR-0075).',
      foreign:
        "Tier-3 token `var({{name}})` is the `{{owner}}` plugin's own vocabulary. Use a semantic role, or move the concept into tier 2 if it is one the design system names (ADR-0075).",
    },
  },
  create(context) {
    const byName = loadManifest();
    function check(node) {
      const text = textOf(node);
      if (!text || !text.includes('var(--')) return;
      // Capture uppercase letters too: CSS custom properties are case-sensitive,
      // so a typo'd `var(--Accent)` does not resolve to `--color-accent` and must
      // still be flagged rather than silently skipped by a lowercase-only match.
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*[,)]/g)) {
        const name = m[1];
        if (name.startsWith('--_')) continue; // private indirection var, outside the contract
        if (BUILTIN_TOKENS.has(name)) continue;
        const decl = byName.get(name);
        const messageId = disallowedReason(name, decl, context.filename);
        if (messageId) context.report({ node, messageId, data: { name, owner: decl?.owner } });
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
    const shadowUtilities = loadShadowUtilities();
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
