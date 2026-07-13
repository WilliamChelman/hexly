import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The e2e project drives the real web app, so it may reuse the app's own framework-free
    // helpers (pretty-URL codec, View-instance codec) directly by file path.
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '^.*/libs/web-core/src/utils/pretty-id$',
            '^.*/libs/web-entity/src/lib/view-instance$',
          ],
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
];
