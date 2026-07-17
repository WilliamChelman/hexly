import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/plugin-content-server',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'plugin-content-server',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/plugin-content-server',
      provider: 'v8' as const,
    },
  },
}));
