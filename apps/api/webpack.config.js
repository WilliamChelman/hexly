const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      additionalEntryPoints: [
        { entryName: 'seed', entryPath: './src/seed.ts' },
      ],
      tsConfig: './tsconfig.app.json',
      // Migrations are read at boot via `resolve(__dirname, 'migrations')`; map
      // them to the bundle root so dist mirrors the source layout (ADR-0027).
      assets: [
        './src/assets',
        {
          input: './src/app/db/migrations',
          output: 'migrations',
          glob: '**/*',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
