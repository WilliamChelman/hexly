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
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '@hexly/web-core/testing',
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
