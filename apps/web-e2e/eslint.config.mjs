import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The e2e project drives the real web app, so it may reuse the app's own
    // source helpers — the pretty-URL codec (web-core) and the View-instance codec
    // (web-entity), both framework-free — directly by file path, rather than
    // duplicating them or dragging in the Angular barrel.
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
