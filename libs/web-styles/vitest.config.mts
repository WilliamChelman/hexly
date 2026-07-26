import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// The manifest is plain data + string generation, and the stylesheet spec drives the real postcss
// pipeline, so both test in node — no browser, no app build.
// `typecheck` is what makes "a typo in a token name is a type error" (ADR-0075) an assertion rather
// than a claim: nothing else in the workspace typechecks this leaf lib.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/web-styles',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'web-styles',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
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
