import nx from '@nx/eslint-plugin';
import hexlyDesignTokens from './eslint-rules/design-tokens.mjs';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts'],
    plugins: { 'hexly-design': hexlyDesignTokens },
    rules: {
      // ADR-0020, amended by ADR-0075 — every var(--…) resolves to a manifest-declared token on the
      // right side of the tier boundary; built-in shadow utilities bake a Solar value (ADR-0021).
      // At the root, not opted into per project: the contract is one about strings, so it holds
      // wherever one can be written, and an opt-in list had it covering 6 of 13 browser libs.
      'hexly-design/no-unknown-design-token': 'error',
      'hexly-design/no-builtin-shadow': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          // web-core exposes its test doubles via a secondary entry point that
          // is deliberately kept out of the production barrel (the mocks lean on
          // the ambient `vi` global); allow specs to reach it.
          // The two pure utils below (pretty-id, locale-key-sync) are reached by
          // direct file path from non-Angular runtimes (Playwright fixtures, the
          // jiti-run i18n-sync tool) that must not drag in the barrel's Angular
          // services layer; neither runtime resolves the tsconfig `paths` alias,
          // so a relative import is used and waived here.
          // admin-web hosts a lazily-routed page (its barrel is `import()`-ed by the route), which
          // marks the whole project lazy. Its `/i18n` entry must still be imported eagerly (ADR-0049,
          // the route `title` needs the scope before the page loads); that entry carries only the
          // scope declaration and JSON loaders, so it never drags the page barrel into the eager bundle.
          // The Desktop App's Electron main is a second entry point onto the *same* Nest app, hosted
          // in-process (ADR-0070), so `apps/desktop` genuinely depends on `apps/api`. It reaches it
          // through exactly one file — `apps/api/src/host.ts`, the embedding surface — which is a
          // tighter boundary than extracting the composition root into a lib for one consumer.
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '@hexly/web-core/testing',
            '@hexly/admin-web/i18n',
            '^.*/libs/web-core/src/(utils/pretty-id|i18n/locale-key-sync)$',
            '^\\.\\./\\.\\./api/src/host$',
          ],
          // ponytail: layering (core←ui←app) holds by construction and review;
          // left permissive because a type:* matrix would need every existing
          // lib (domain/immer/obsidian) tagged. Tighten when that's worth doing.
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    // Override or add rules here
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'immer',
              message:
                "Import from '@hexly/immer' instead — it boots enablePatches() and is the single Immer entrypoint.",
            },
          ],
        },
      ],
    },
  },
];
