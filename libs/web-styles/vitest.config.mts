import { defineConfig } from 'vitest/config';

// The manifest is plain data + string generation, so it tests in node — no browser, no app build.
// `typecheck` is what makes "a typo in a token name is a type error" (ADR-0075) an assertion rather
// than a claim: nothing else in the workspace typechecks this leaf lib.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/web-styles',
  test: {
    name: 'web-styles',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.spec.json',
      include: ['src/**/*.spec-d.ts'],
    },
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/web-styles',
      provider: 'v8' as const,
    },
  },
}));
