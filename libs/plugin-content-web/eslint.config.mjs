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
      // Every var(--…) must resolve to a defined design token (ADR-0020); built-in
      // shadow utilities are barred because they bake in a light value (ADR-0021).
      'hexly-design/no-unknown-design-token': 'error',
      'hexly-design/no-builtin-shadow': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      // Element components (Chip, Coord, Icon) are kebab-case. Components that attach to a
      // native element via an attribute selector (Button, Panel, Tool, …) to keep that
      // element's semantics/a11y (ADR-0007) are camelCase, like a directive.
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
