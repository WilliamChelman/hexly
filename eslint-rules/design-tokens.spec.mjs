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
