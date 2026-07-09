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
      // ADR-0045 — one write handle per resource, so that the `seq` bump and the post-commit nudge
      // cannot be forgotten. Without these guards the omission is silent: a revoked grant leaves
      // its Viewer live-following a private Entity, and a World-owner promotion leaves them
      // holding a read-only Rights array on the World's shared Entities. Both shipped.
      'hexly-writes/no-direct-entity-writes': 'error',
      'hexly-writes/no-direct-world-writes': 'error',
    },
  },
];
