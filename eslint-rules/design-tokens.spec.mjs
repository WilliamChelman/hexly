/**
 * Tests for eslint-rules/design-tokens.mjs.
 * Run: node --test eslint-rules/design-tokens.spec.mjs  (from repo root)
 *
 * RuleTester throws on failures, so each `tester.run(...)` call is itself the assertion.
 */
import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import designTokens from './design-tokens.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2020 } });

/** Paths the rule reads the tier boundary from — a plugin lib, a core lib, and the styleguide. */
const IN_HEXMAP = '/repo/libs/plugin-hexmap-web/src/components/inspector.component.ts';
const IN_BOARD = '/repo/libs/plugin-board-web/src/components/board-canvas.component.ts';
const IN_UI = '/repo/libs/web-ui/src/components/chip.component.ts';
const IN_STYLEGUIDE = '/repo/apps/web/src/app/pages/styleguide/styleguide.page.ts';

describe('no-unknown-design-token', () => {
  const rule = designTokens.rules['no-unknown-design-token'];

  it('accepts a declared token and rejects one the manifest does not declare', () => {
    tester.run('no-unknown-design-token', rule, {
      valid: [
        { code: 'const s = `:host { color: var(--color-ink); }`', filename: IN_UI },
        // A component-local indirection var is the component's own, not a token.
        { code: 'const s = `:host { color: var(--_tint, var(--color-accent)); }`', filename: IN_UI },
        // Tailwind's own `@theme` defaults are declared by Tailwind, not by the manifest.
        { code: 'const s = `:host { padding: calc(var(--spacing) * 2); }`', filename: IN_UI },
      ],
      invalid: [
        {
          code: 'const s = `:host { color: var(--color-acccent); }`',
          filename: IN_UI,
          errors: [{ messageId: 'unknown' }],
        },
        // CSS custom properties are case-sensitive, so a typo'd case is still a dead reference.
        {
          code: 'const s = `:host { color: var(--Color-Ink); }`',
          filename: IN_UI,
          errors: [{ messageId: 'unknown' }],
        },
      ],
    });
  });

  /**
   * Two branches reach the same message and both carry weight: `--palette-accent` and `--palette-veil`
   * are declared, so the manifest *tier* bars them; `--palette-nothing` is declared nowhere, and the
   * name alone bars it — a mistyped anchor is still named as the layering mistake, not as a typo.
   */
  it('bars a component from reaching past the semantic role to a Palette anchor', () => {
    tester.run('no-unknown-design-token', rule, {
      valid: [],
      invalid: [
        {
          code: 'const s = `:host { color: var(--palette-accent); }`',
          filename: IN_UI,
          errors: [{ messageId: 'palette' }],
        },
        {
          code: 'const s = `:host { opacity: var(--palette-veil); }`',
          filename: IN_HEXMAP,
          errors: [{ messageId: 'palette' }],
        },
        {
          code: 'const s = `:host { color: var(--palette-nothing); }`',
          filename: IN_UI,
          errors: [{ messageId: 'palette' }],
        },
      ],
    });
  });

  it("lets a plugin use its own tier-3 vocabulary and nobody else's", () => {
    tester.run('no-unknown-design-token', rule, {
      valid: [{ code: 'const s = `:host { fill: var(--color-terrain-forest); }`', filename: IN_HEXMAP }],
      invalid: [
        {
          code: 'const s = `:host { fill: var(--color-terrain-forest); }`',
          filename: IN_BOARD,
          errors: [{ messageId: 'foreign', data: { name: '--color-terrain-forest', owner: 'hexmap' } }],
        },
        {
          code: 'const s = `:host { stroke: var(--color-hex-line); }`',
          filename: IN_UI,
          errors: [{ messageId: 'foreign' }],
        },
      ],
    });
  });

  it('exempts the styleguide from the tier gates but not from the manifest', () => {
    tester.run('no-unknown-design-token', rule, {
      valid: [
        {
          code: 'const s = `<span [style.background]="\'var(--color-terrain-forest)\'"></span>`',
          filename: IN_STYLEGUIDE,
        },
      ],
      invalid: [
        // A token the styleguide renders still has to exist — an anchor spelled wrong is a dead
        // swatch, and the exemption is from the tier boundary only.
        {
          code: 'const s = `:host { color: var(--color-terrain-swamp); }`',
          filename: IN_STYLEGUIDE,
          errors: [{ messageId: 'unknown' }],
        },
        {
          code: 'const s = `:host { color: var(--palette-inkk); }`',
          filename: IN_STYLEGUIDE,
          errors: [{ messageId: 'unknown' }],
        },
      ],
    });
  });
});

describe('no-builtin-shadow', () => {
  const rule = designTokens.rules['no-builtin-shadow'];

  it('flags Tailwind built-in shadow utilities in class strings', () => {
    tester.run('no-builtin-shadow', rule, {
      valid: [
        // Arbitrary values are always fine (explicit opt-out).
        { code: 'const c = `class="shadow-[0_2px_4px_rgba(0,0,0,0.2)]"`' },
        // shadow-none draws no shadow — nothing themeable to bake.
        { code: 'const c = `class="focus-visible:shadow-none"`' },
        // Non-shadow tokens aren't touched.
        { code: 'const c = `class="rounded-md border border-line"`' },
        // The word "shadow" inside a CSS comment is prose, not a utility — the
        // styles-block comment scan strips comments first (ADR-0031).
        { code: 'const c = `:host { /* layered glow shadow */ color: red; }`' },
      ],
      invalid: [
        {
          code: 'const c = `class="rounded-md shadow-lg"`',
          errors: [{ messageId: 'builtin' }],
        },
        {
          code: 'const c = `class="shadow-sm p-2"`',
          errors: [{ messageId: 'builtin' }],
        },
        {
          code: 'const x = { class: "shadow-xl" }',
          errors: [{ messageId: 'builtin' }],
        },
        {
          code: 'const c = `class="shadow-md shadow-lg"`',
          errors: [{ messageId: 'builtin' }, { messageId: 'builtin' }],
        },
      ],
    });
  });
});

describe('no-builtin-radius', () => {
  const rule = designTokens.rules['no-builtin-radius'];

  it('flags the bare `rounded` utility, on every corner it can name', () => {
    tester.run('no-builtin-radius', rule, {
      valid: [],
      invalid: [
        // The steps it offers are read off the manifest, so the advice cannot drift from the
        // set a World Theme actually writes (ADR-0076).
        {
          code: 'const c = `class="rounded border border-line"`',
          errors: [
            {
              message:
                "Bare `rounded` is a hard-coded 4px that exists outside the token contract, so a World Theme's corner set never reaches it. Name a step: `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-full` (or `rounded-none`) — ADR-0076.",
            },
          ],
        },
        // A side/corner variant with no step is the same hard-coded 4px on fewer corners.
        {
          code: 'const c = `class="rounded-t rounded-bl"`',
          errors: [{ messageId: 'bare' }, { messageId: 'bare' }],
        },
        { code: 'const x = { class: "rounded" }', errors: [{ messageId: 'bare' }] },
        // Variants and the important flag are spellings of the same utility.
        { code: 'const c = `class="hover:rounded"`', errors: [{ messageId: 'bare' }] },
        { code: 'const c = `class="rounded!"`', errors: [{ messageId: 'bare' }] },
      ],
    });
  });

  it("flags the scale steps Tailwind declares and the manifest doesn't", () => {
    tester.run('no-builtin-radius', rule, {
      valid: [],
      invalid: [
        { code: 'const c = `class="rounded-xs"`', errors: [{ messageId: 'offScale' }] },
        { code: 'const c = `class="rounded-2xl"`', errors: [{ messageId: 'offScale' }] },
        { code: 'const c = `class="rounded-t-3xl"`', errors: [{ messageId: 'offScale' }] },
        { code: 'const c = `class="rounded-4xl"`', errors: [{ messageId: 'offScale' }] },
      ],
    });
  });

  it('accepts the manifest-backed steps, on any corner and behind any variant', () => {
    tester.run('no-builtin-radius', rule, {
      valid: [
        { code: 'const c = `class="rounded-sm rounded-md rounded-lg rounded-xl rounded-full"`' },
        // `rounded-sm` is the `sm` step, not the `s` (inline-start) side with no step.
        { code: 'const c = `class="rounded-s-md rounded-tl-lg rounded-b-sm"`' },
        { code: 'const c = `class="focus-visible:rounded-md"`' },
        // rounded-none squares the corner outright — nothing for a World's set to carry.
        { code: 'const c = `class="rounded-none"`' },
        // Arbitrary values are an explicit opt-out, as they are for elevation.
        { code: 'const c = `class="rounded-[3px] rounded-b-[calc(var(--radius-md)*2)]"`' },
        // Words that merely start with the utility's name are not it.
        { code: 'const c = `class="roundedish"`' },
      ],
      invalid: [],
    });
  });

  it('reads an @apply in a scoped styles block, and leaves prose alone', () => {
    tester.run('no-builtin-radius', rule, {
      valid: [
        { code: 'const s = `.banner { @apply rounded-md bg-surface; }`' },
        // "rounded" is an ordinary English word, so a comment on either side of the
        // template boundary is prose and not a utility.
        { code: 'const s = `.card { /* a rounded card */ @apply rounded-lg; }`' },
        { code: 'const t = `<!-- a rounded card + rounded toggle strip --><div class="rounded-lg"></div>`' },
      ],
      invalid: [{ code: 'const s = `.banner { @apply rounded bg-surface; }`', errors: [{ messageId: 'bare' }] }],
    });
  });
});
