import baseConfig from '../../eslint.config.mjs';
import hexlyDesignTokens from '../../eslint-rules/design-tokens.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    plugins: { 'hexly-design': hexlyDesignTokens },
    rules: {
      // A corner may only take a step the manifest declares, so a World Theme's
      // corner-radius set reaches every one of them (ADR-0076).
      'hexly-design/no-builtin-radius': 'error',
    },
  },
];
