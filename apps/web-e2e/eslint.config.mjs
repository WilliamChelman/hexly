import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // E2E specs legitimately import from devDependencies (@playwright/test) and
    // are not part of the app's published surface.
    files: ['**/*.ts', '**/*.mjs'],
    rules: {},
  },
];
