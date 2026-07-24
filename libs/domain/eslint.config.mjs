import baseConfig from '../../eslint.config.mjs';
import hexlyPluginSeam from '../../eslint-rules/plugin-seam.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    // Specs may import the very converter under test or a plugin fake; the seam is a production rule.
    ignores: ['**/*.spec.ts'],
    plugins: { 'hexly-seam': hexlyPluginSeam },
    rules: {
      // ADR-0051 — the domain knows prose only as the opaque `core.rich-content` data-type; the
      // Content seam and the editor left for `@hexly/plugin-content`, and must not creep back.
      'hexly-seam/no-content-or-tiptap-import': 'error',
    },
  },
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
