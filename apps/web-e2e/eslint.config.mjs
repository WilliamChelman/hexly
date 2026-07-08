import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The e2e project drives the real web app, so it may reuse the app's own
    // source helpers (e.g. the pretty-URL codec, now in web-core) directly by
    // file path rather than duplicating them or dragging in the Angular barrel.
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '^.*/libs/web-core/src/utils/pretty-id$',
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
