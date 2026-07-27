import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';
import hexlyDesignTokens from '../../eslint-rules/design-tokens.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    plugins: { 'hexly-design': hexlyDesignTokens },
    rules: {
      // ADR-0020 — every var(--…) must resolve to a defined design token, and built-in
      // shadow utilities (which bake a light value) are barred (ADR-0021).
      'hexly-design/no-unknown-design-token': 'error',
      'hexly-design/no-builtin-shadow': 'error',
      // A corner may only take a step the manifest declares, so a World Theme's
      // corner-radius set reaches every one of them (ADR-0076).
      'hexly-design/no-builtin-radius': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      // Element components (Chip, Coord, Icon) stay kebab-case; components that attach to a
      // native element via an attribute selector to keep its semantics/a11y (Button, Panel,
      // Tool, … — ADR-0007) are camelCase like a directive.
      '@angular-eslint/component-selector': [
        'error',
        [
          { type: 'element', prefix: 'app', style: 'kebab-case' },
          { type: 'attribute', prefix: 'app', style: 'camelCase' },
        ],
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
