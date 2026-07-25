/**
 * Packaging for the Desktop App (#327, ADR-0070). Run from the workspace root — the *project directory*
 * electron-builder resolves everything against is the cwd, not this file's folder:
 *
 *     pnpm package:desktop        # nx run desktop:package — builds, packages, then smoke-tests the package
 *     pnpm exec electron-builder --config apps/desktop/electron-builder.config.js
 *
 * The **app directory is the workspace root**, which is what makes dependency pruning right by construction
 * rather than by a maintained list — ADR-0070 says why. It is also why the root `package.json` carries a
 * `description` and an `author`: they become this app's metadata.
 */
/**
 * The version to label the artifact with, when a release has one to give (#328). Otherwise electron-builder
 * reads the root `package.json`, which is `0.0.0` and stays there — semantic-release cuts tags without an npm
 * plugin to write versions back (`release.config.js`) — so a developer's local package is honestly `0.0.0`.
 */
const releaseVersion = process.env.HEXLY_VERSION?.replace(/^v/, '');

/**
 * The host architecture only. `sharp`'s prebuilds and its libvips are per-platform *and* per-arch optional
 * dependencies, and `better-sqlite3` is rebuilt against the local toolchain, so an install on this machine
 * holds binaries for this machine and nothing else. Each release runner builds its own platform (ADR-0070,
 * #328) rather than one machine cross-building three.
 */
const arch = [process.arch === 'arm64' ? 'arm64' : 'x64'];

module.exports = {
  appId: 'io.github.williamchelman.hexly',
  /**
   * The artifact's name, which has to stay the name `main.ts` gives the app itself with `electron.setName` —
   * `packaging.spec.ts` holds the two together. Main pins that name *before* anything reads `userData`, so a
   * drift here is cosmetic rather than an Instance in a second folder (ADR-0070); what it does break is every
   * path derived from the bundle's name, the smoke check's included.
   */
  productName: 'Hexly',
  extraMetadata: {
    main: 'dist/apps/desktop/main.js',
    // The root package is `@hexly/source`, a name for a repo rather than for an app — and it is what the Linux
    // package name and the Windows installer would otherwise be derived from.
    name: 'hexly',
    ...(releaseVersion && { version: releaseVersion }),
  },
  directories: { output: 'dist/desktop' },
  /**
   * Both bundles, and nothing else from the repo. The SPA is served over HTTP by the Nest app in main
   * (ADR-0008), which finds it at `../web/browser` relative to its own directory — so the two have to keep
   * their `dist/apps/*` layout inside the archive. `node_modules` is not listed because electron-builder
   * collects production dependencies itself.
   */
  files: ['dist/apps/desktop/**', 'dist/apps/web/browser/**'],
  /**
   * Native code cannot be `dlopen`ed out of an asar archive. Stated rather than left to electron-builder's own
   * detection of modules containing a `.node`, because the image library's binaries live in *sibling* packages
   * — and getting that wrong surfaces during thumbnailing, not at build time (ADR-0070).
   */
  asarUnpack: [
    // The SQLite binding, rebuilt for Electron's ABI (ADR-0027, ADR-0070).
    '**/node_modules/better-sqlite3/**',
    // The image library, its per-platform prebuilt binary, and the libvips dylib that binary links against.
    '**/node_modules/sharp/**',
    '**/node_modules/@img/**',
    // napi-rs and ABI-stable, so it rides along — but it is still a native addon and still needs unpacking.
    '**/node_modules/@node-rs/**',
  ],
  /**
   * The `desktop:rebuild-native` target owns the Electron rebuild instead, and `desktop:package` runs it first.
   * electron-builder's own rebuild is not forced, so `@electron/rebuild`'s `.forge-meta` marker makes it a
   * no-op that packages Node's ABI against Electron's (ADR-0070); `rebuild-native` passes `--force`, and its
   * ad-hoc re-signing matters more here than in dev because nothing below signs anything.
   */
  npmRebuild: false,
  /**
   * No publish provider, so no `app-update.yml` in the bundle and no electron-updater anywhere. **Unsigned and
   * no-updater are one decision, not two**: Squirrel.Mac refuses to update a bundle that is not signed, so an
   * updater here could only ever fail (ADR-0070). Signing later is this config plus secrets — `mac.identity`,
   * `win.certificateFile`, a notarization step — and it re-opens the updater in the same change.
   */
  publish: null,
  mac: {
    target: [{ target: 'dmg', arch }],
    category: 'public.app-category.productivity',
    /**
     * Explicitly unsigned: `null` means "do not go looking for an identity", so a developer who happens to
     * hold an Apple certificate gets the same artifact CI does. Users are told to go through System
     * Settings → Privacy & Security → "Open Anyway" (#328); the Finder right-click bypass is gone on
     * recent macOS.
     */
    identity: null,
    /** Nothing to notarize without a signature, and asking would fail the build rather than warn. */
    notarize: false,
  },
  win: {
    target: [{ target: 'nsis', arch }],
  },
  linux: {
    /** AppImage: no package manager, no root, closest thing Linux has to "download and open". */
    target: [{ target: 'AppImage', arch }],
    category: 'Office',
    /** Stated, not derived from the package name, so the smoke check knows what to launch. */
    executableName: 'hexly',
  },
};
