import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
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
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '@hexly/web-core/testing',
            '^.*/libs/web-core/src/(utils/pretty-id|i18n/locale-key-sync)$',
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
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
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
