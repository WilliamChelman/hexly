import config from '../electron-builder.config.js';
import { APP_NAME } from './instance-dir';

/**
 * The three packaging facts that fail *silently* or *late* if they drift. Everything else about a package is
 * asserted by opening one — `apps/desktop-e2e/src/packaged/packaged-app.spec.ts` does that after every build.
 */
describe('the electron-builder configuration', () => {
  it('names the artifact what main names the app', () => {
    // The bundle's name and the app's own name are the same name, and every path derived from the bundle — the
    // packaged smoke check's included — is spelled from the former.
    expect(config.productName).toBe(APP_NAME);
  });

  it('unpacks every native module from the archive', () => {
    // Native code cannot be `dlopen`ed out of an asar. The image library is the one to watch: its binaries sit
    // in sibling `@img/*` packages, and getting it wrong shows up during thumbnailing, not at build time.
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
    // One decision, not two: Squirrel.Mac will not update an unsigned bundle, so a publish provider here could
    // only ever ship an updater that fails (ADR-0070). Adding signing later is what re-opens the updater.
    expect(config.publish).toBeNull();
    expect(config.mac.identity).toBeNull();
    expect(config.mac.notarize).toBe(false);
  });
});
