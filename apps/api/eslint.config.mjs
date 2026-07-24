import baseConfig from '../../eslint.config.mjs';
import hexlyNudgeWrites from '../../eslint-rules/nudge-writes.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    // Specs seed fixtures directly into the guarded tables. Nothing follows a fixture, so there is
    // no nudge to miss — and routing every seed through the write handles would test the modules
    // against themselves.
    ignores: ['**/*.spec.ts'],
    plugins: { 'hexly-writes': hexlyNudgeWrites },
    rules: {
      // ADR-0045 — one write handle per resource: a direct write skips the `seq` bump and the
      // post-commit nudge, and the omission is silent (stale Viewers keep live-following).
      'hexly-writes/no-direct-entity-writes': 'error',
      'hexly-writes/no-direct-world-writes': 'error',
    },
  },
];
