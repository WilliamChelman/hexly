/**
 * Packaging for the Desktop App (#327, ADR-0070). Must run from the workspace root: electron-builder resolves
 * against the cwd, and the app directory being the root is what makes dependency pruning right by construction
 * (ADR-0070) — hence also the root `package.json`'s `description` and `author`.
 *
 *     pnpm package:desktop        # nx run desktop:package — builds, packages, then smoke-tests the package
 *     pnpm exec electron-builder --config apps/desktop/electron-builder.config.js
 */
/** The version a release has to give (#328); otherwise the root `package.json`'s `0.0.0` stands. */
const releaseVersion = process.env.HEXLY_VERSION?.replace(/^v/, '');

/**
 * The host architecture only: `sharp`'s prebuilds are per-platform *and* per-arch, and `better-sqlite3` is
 * rebuilt against the local toolchain, so each release runner builds its own platform (ADR-0070, #328).
 */
const arch = [process.arch === 'arm64' ? 'arm64' : 'x64'];

/**
 * One name per download on the one Releases page three runners upload to (#328); electron-builder's defaults
 * would collide across platforms. Single-quoted: the `${...}` are electron-builder's macros, and it spells
 * `${arch}` per extension, so an AppImage's is `x86_64` where the dmg's is `x64`.
 */
const artifactName = (platform) => '${productName}-${version}-' + platform + '-${arch}.${ext}';

module.exports = {
  appId: 'io.github.williamchelman.hexly',
  /**
   * Has to stay the name `main.ts` gives the app with `electron.setName` (ADR-0070), since every path derived
   * from the bundle's name depends on it; `packaging.spec.ts` holds the two together.
   */
  productName: 'Hexly',
  extraMetadata: {
    main: 'dist/apps/desktop/main.js',
    // The Linux package name and the Windows installer would otherwise derive from the root `@hexly/source`.
    name: 'hexly',
    ...(releaseVersion && { version: releaseVersion }),
  },
  directories: { output: 'dist/desktop' },
  /**
   * The Nest app in main finds the SPA at `../web/browser` relative to its own directory (ADR-0008), so the two
   * have to keep their `dist/apps/*` layout inside the archive. `node_modules` is unlisted because
   * electron-builder collects production dependencies itself.
   */
  files: ['dist/apps/desktop/**', 'dist/apps/web/browser/**'],
  /**
   * Native code cannot be `dlopen`ed out of an asar archive. Stated rather than left to electron-builder's `.node`
   * detection, because the image library's binaries live in *sibling* packages (ADR-0070).
   */
  asarUnpack: [
    // The SQLite binding, rebuilt for Electron's ABI (ADR-0027, ADR-0070).
    '**/node_modules/better-sqlite3/**',
    // The image library, its per-platform prebuilt binary, and the libvips dylib that binary links against.
    '**/node_modules/sharp/**',
    '**/node_modules/@img/**',
    // ABI-stable napi-rs, but still a native addon.
    '**/node_modules/@node-rs/**',
  ],
  /**
   * `desktop:rebuild-native` owns the Electron rebuild and `desktop:package` runs it first: electron-builder's
   * own rebuild is unforced, so `@electron/rebuild`'s `.forge-meta` marker makes it a no-op that packages Node's
   * ABI against Electron's (ADR-0070).
   */
  npmRebuild: false,
  /**
   * No publish provider, so no `app-update.yml` and no electron-updater. Unsigned and no-updater are one
   * decision: Squirrel.Mac refuses to update an unsigned bundle, so an updater here could only fail (ADR-0070).
   */
  publish: null,
  mac: {
    target: [{ target: 'dmg', arch }],
    artifactName: artifactName('macos'),
    category: 'public.app-category.productivity',
    // Explicitly unsigned, so a developer holding an Apple certificate still gets the artifact CI does (#328).
    identity: null,
    /** Nothing to notarize without a signature, and asking would fail the build rather than warn. */
    notarize: false,
  },
  win: {
    target: [{ target: 'nsis', arch }],
    artifactName: artifactName('windows'),
  },
  linux: {
    /** AppImage: no package manager, no root, closest thing Linux has to "download and open". */
    target: [{ target: 'AppImage', arch }],
    artifactName: artifactName('linux'),
    category: 'Office',
    /** Stated, not derived from the package name, so the smoke check knows what to launch. */
    executableName: 'hexly',
  },
};
