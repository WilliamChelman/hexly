import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The e2e project drives the real web app, so it may reuse web's own source
    // helpers (e.g. the pretty-URL codec) directly rather than duplicating them.
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$', '/web/src/'],
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
