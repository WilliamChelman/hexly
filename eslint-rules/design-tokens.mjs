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
 * Tailwind's built-ins bake a light-scheme value (ADR-0021).
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

/**
 * The corner steps a World's radius set actually reaches: the manifest's `--radius-*` tokens, as
 * `rounded-*` suffixes. Tailwind's own `@theme` also declares `--radius-xs/-2xl/-3xl/-4xl`, which
 * ours does not override and the manifest does not carry — so those steps are fixed lengths however
 * an Owner sets their corners (ADR-0076).
 */
function radiusSteps() {
  const prefix = '--radius-';
  return new Set(
    [...loadManifest().keys()].filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)),
  );
}

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
 * The one file exempt from this rule outright, and the only grant of its kind: it classifies
 * declaration *strings*, so every `var(--…)` in it is a fixture rather than a style. The exemption has
 * to be from the manifest too, not just the tier boundary — a tier-1 anchor is the reference the
 * classifier exists to recognise, and a name no manifest declares is the one it has to refuse, so both
 * are cases it must be able to write down. Spelled as a path for the reason the styleguide is: the
 * grant stays reviewable in one place, and no lint config can hand it to anyone else.
 */
const DECLARATION_FIXTURES = 'libs/web-styles/src/tokens/declared.spec.ts';

/**
 * Why a `var(--…)` reference is not allowed from this file, or `null` when it is fine.
 *
 * An undeclared name is a typo first and a tier breach second — including in the styleguide, which
 * is exempt from the boundary but not from the manifest: a token it renders still has to exist.
 * Past that, `--palette-*` is tier 1 by convention as well as by manifest (ADR-0075), so an anchor
 * reference is named as the layering mistake it is from the first one written.
 */
function disallowedReason(name, decl, filename) {
  const path = posix(filename);
  if (path.endsWith(DECLARATION_FIXTURES)) return null;
  const everyTier = path.includes(STYLEGUIDE);
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

/**
 * The utility names in a class string. Separators cover Angular's template punctuation, so a
 * variant prefix (`hover:shadow-lg`) and a binding (`[class]="'rounded'"`) both yield the bare
 * utility; a trailing `!` is Tailwind's important flag on the same utility, not part of its name.
 */
function* classTokens(text) {
  for (const raw of text.split(/[\s"'`=<>(){},;:]+/)) yield raw.replace(/!$/, '');
}

/**
 * The visitors a class-string rule needs: every template literal (component templates and scoped
 * styles alike), plus the string literals that carry classes — a `class:` property or raw markup.
 * Shared so the two utility fences below cannot drift apart on what they even look at.
 */
function classStringVisitors(scan) {
  const visit = (node) => {
    const text = textOf(node);
    if (text) scan(node, text);
  };
  return {
    TemplateLiteral: visit,
    Literal(node) {
      if (typeof node.value !== 'string') return;
      const p = node.parent;
      const isClassProp =
        !!p && p.type === 'Property' && p.value === node && (p.key.name === 'class' || p.key.value === 'class');
      if (isClassProp || node.value.includes('class=')) visit(node);
    },
  };
}

/**
 * Every spelling of the radius utility, split into the corners it lands on and the scale step it
 * takes — `rounded-tl-md` is the `md` step on one corner. The step is optional because bare
 * `rounded` is the whole point: it is a hard-coded 4px, not a step. The side alternatives are
 * written out so `rounded-sm` reads as the `sm` step and not as the `s` side.
 */
const RADIUS_UTILITY = /^rounded(?:-(?:s|e|t|r|b|l|ss|se|ee|es|tl|tr|br|bl))?(?:-(.+))?$/;

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
        'Built-in shadow utility `{{cls}}` bakes a light-scheme value and ignores [data-color-scheme]. Use shadow-1, shadow-2, shadow-3, or shadow-inset instead (ADR-0021).',
    },
  },
  create(context) {
    const shadowUtilities = loadShadowUtilities();
    return classStringVisitors((node, text) => {
      for (const tok of classTokens(text)) {
        if (!tok.startsWith('shadow-') && tok !== 'shadow') continue;
        if (tok.includes('[')) continue; // explicit arbitrary value — intentional opt-out
        if (tok === 'shadow-none') continue; // no shadow at all — nothing themeable to bake
        if (!shadowUtilities.has(tok)) {
          context.report({ node, messageId: 'builtin', data: { cls: tok } });
        }
      }
    });
  },
};

const noBuiltinRadius = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow radius utilities no `--radius-*` token backs, so every corner follows a World Theme's corner set (ADR-0076).",
    },
    schema: [],
    messages: {
      bare: "Bare `{{cls}}` is a hard-coded 4px that exists outside the token contract, so a World Theme's corner set never reaches it. Name a step: {{steps}} (or `rounded-none`) — ADR-0076.",
      offScale:
        "`{{cls}}` takes a step the manifest does not declare — Tailwind's own scale, or nothing at all — so a World Theme's corner set never reaches it. Name a step: {{steps}} (or `rounded-none`) — ADR-0076.",
    },
  },
  create(context) {
    const steps = radiusSteps();
    const named = [...steps].map((step) => `\`rounded-${step}\``).join(', ');
    return classStringVisitors((node, text) => {
      for (const cls of classTokens(text)) {
        const match = RADIUS_UTILITY.exec(cls);
        if (!match) continue;
        const step = match[1];
        if (step === undefined) {
          context.report({ node, messageId: 'bare', data: { cls, steps: named } });
          continue;
        }
        if (step === 'none') continue; // squares the corner outright — nothing for a set to carry
        // A bracket is a stated choice, not the accidental default this rule exists to catch, and
        // it is the only way to spell a corner off the ladder — `rounded-[calc(var(--radius-md)*2)]`
        // included. Same opt-out `no-builtin-shadow` grants.
        if (step.startsWith('[')) continue;
        if (steps.has(step)) continue;
        context.report({ node, messageId: 'offScale', data: { cls, steps: named } });
      }
    });
  },
};

export default {
  rules: {
    'no-unknown-design-token': noUnknownDesignToken,
    'no-builtin-shadow': noBuiltinShadow,
    'no-builtin-radius': noBuiltinRadius,
  },
};
