import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';
import hexlyPluginSeam from '../../eslint-rules/plugin-seam.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      // Element components (Chip, Coord, Icon) stay kebab-case. A component may also attach
      // to a native element via an attribute selector (Button, Panel, Tool, …) to keep that
      // element's semantics/a11y (ADR-0007); those are camelCase like a directive.
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
    files: ['**/*.ts'],
    // Specs hand-build TypeDefinition fakes to drive the registry and views under test — nothing
    // ships them, so a fixture Type is no seam breach. This exemption matches the other repo rules.
    ignores: ['**/*.spec.ts'],
    plugins: { 'hexly-seam': hexlyPluginSeam },
    rules: {
      // ADR-0051 — the app declares no Entity Type and calls no `defineType()`; it names no View
      // but the generic `core.view.fields`. Every other Type and View is a plugin's.
      'hexly-seam/no-type-definition-declaration': 'error',
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
