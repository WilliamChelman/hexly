const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

/**
 * The Desktop App's two bundles (ADR-0070): the Electron main process — which hosts the whole Nest
 * `AppModule`, so this build pulls the API's source graph in exactly as `apps/api` does — and the
 * preload script that runs in the renderer.
 *
 * `target: 'node'` rather than a webpack `electron-*` target: the electron runtime provides `electron`
 * itself (declared external below) and every other dependency stays external, so there is nothing an
 * electron target would add beyond a second resolution mode to reason about.
 */
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/desktop'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // Provided by the electron runtime, never resolvable from node_modules as a bundle-able module.
  externals: { electron: 'commonjs electron' },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      additionalEntryPoints: [{ entryName: 'preload', entryPath: './src/preload.ts' }],
      tsConfig: './tsconfig.app.json',
      // The migrations the API reads at boot via `resolve(__dirname)` (ADR-0027) — this bundle is a
      // second host for that same code, so it needs its own copy beside it.
      assets: [
        {
          input: '../api/src/app/db/migrations',
          output: 'migrations',
          glob: '**/*',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      sourceMap: true,
    }),
  ],
};
