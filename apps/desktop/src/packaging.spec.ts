import config from '../electron-builder.config.js';
import { APP_NAME } from './instance-dir';

/**
 * The packaging facts that fail *silently* or *late* if they drift; everything else is asserted by opening a
 * package in `apps/desktop-e2e/src/packaged/packaged-app.spec.ts`.
 */
describe('the electron-builder configuration', () => {
  const originalVersion = process.env.HEXLY_VERSION;

  afterEach(() => {
    if (originalVersion === undefined) delete process.env.HEXLY_VERSION;
    else process.env.HEXLY_VERSION = originalVersion;
  });

  it('names the artifact what main names the app', () => {
    // Every path derived from the bundle, the packaged smoke check's included, is spelled from `productName`.
    expect(config.productName).toBe(APP_NAME);
  });

  it('unpacks every native module from the archive', () => {
    // Native code cannot be `dlopen`ed out of an asar; sharp's binaries sit in sibling `@img/*` packages, and a
    // miss shows up during thumbnailing rather than at build time.
    expect(config.asarUnpack).toEqual(
      expect.arrayContaining([
        '**/node_modules/better-sqlite3/**',
        '**/node_modules/sharp/**',
        '**/node_modules/@img/**',
        '**/node_modules/@node-rs/**',
      ]),
    );
  });

  it('configures no signing, no notarization and no updater', () => {
    // Squirrel.Mac will not update an unsigned bundle, so a publish provider could only ship an updater that
    // fails (ADR-0070).
    expect(config.publish).toBeNull();
    expect(config.mac.identity).toBeNull();
    expect(config.mac.notarize).toBe(false);
  });

  // The release workflow attaches each of the three runners' artifacts by globbing `*-$VERSION-*.<ext>` (#328),
  // so a dropped macro attaches nothing.
  it.each([
    ['mac', 'macos'],
    ['win', 'windows'],
    ['linux', 'linux'],
  ] as const)('names the %s artifact for its platform, version and arch', (target, platform) => {
    const artifactName: string = config[target].artifactName;

    expect(artifactName).toContain(`-${platform}-`);
    expect(artifactName.startsWith('${productName}-${version}-')).toBe(true);
    // What tells an Apple Silicon download from an Intel one.
    expect(artifactName).toContain('${arch}');
  });

  it('labels the artifact with the release version when a release has one to give', async () => {
    // Semantic-release writes no version back into `package.json`, so `HEXLY_VERSION` is how a release names
    // what it just tagged.
    process.env.HEXLY_VERSION = 'v9.8.7';
    vi.resetModules();

    const released = (await import('../electron-builder.config.js')).default;

    expect(released.extraMetadata.version).toBe('9.8.7');
  });

  it('leaves the version to `package.json` otherwise', () => {
    // A developer's local package is honestly `0.0.0` rather than wearing a release's number.
    expect(config.extraMetadata.version).toBeUndefined();
  });
});
