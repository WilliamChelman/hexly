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
      // ADR-0020 — the design tokens *are* the Tailwind theme; these guard the
      // curation: every var(--…) must resolve to a defined token, and spacing
      // utilities may only use the curated scale (not Tailwind's multiplier).
      'hexly-design/no-unknown-design-token': 'error',
      'hexly-design/no-off-scale-spacing': 'error',
      'hexly-design/no-builtin-shadow': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      // Element components (Chip, Coord, Icon) stay kebab-case. Components may
      // also attach to a native element via an attribute selector (Button,
      // Panel, Tool, …) so the primitive keeps that element's semantics/a11y
      // while owning its scoped styles (ADR-0007); those are camelCase like a
      // directive. Both forms are configured via the rule's multi-config array.
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
