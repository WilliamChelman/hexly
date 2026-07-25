const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

/**
 * The Desktop App's two bundles (ADR-0070): main, which hosts the whole Nest `AppModule` and so pulls the API's
 * source graph in as `apps/api` does, and the preload script. `target: 'node'` rather than an `electron-*`
 * target, since every dependency including `electron` itself stays external.
 */
module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/desktop'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // Provided by the electron runtime, never resolvable from node_modules.
  externals: { electron: 'commonjs electron' },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      additionalEntryPoints: [{ entryName: 'preload', entryPath: './src/preload.ts' }],
      tsConfig: './tsconfig.app.json',
      // The API reads these at boot via `resolve(__dirname)` (ADR-0027), so this bundle needs its own copy.
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
