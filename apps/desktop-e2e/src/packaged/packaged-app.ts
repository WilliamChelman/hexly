import { join } from 'node:path';
import { defineDesktopTest, expect, type LaunchTarget, workspaceRoot } from '../desktop-app';

/**
 * Everything the smoke check (#327) needs to know about electron-builder's output — where it puts things and
 * what it names them — kept in one module, since those are one fact seen once per platform.
 */

/** `directories.output` in `apps/desktop/electron-builder.config.js`. */
export const packageOutput = join(workspaceRoot, 'dist', 'desktop');

/** The `productName` the builder config pins, and therefore the name of everything it produces. */
const PRODUCT_NAME = 'Hexly';

/** The installer this platform's configured target produces, by extension. */
export const INSTALLER_SUFFIX =
  process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.AppImage';

/**
 * The unpacked app beside that installer, in the folder electron-builder names for the platform and arch it
 * built. Composed rather than searched for, so a run that finds nothing says which path it wanted; the builder
 * config pins the same host arch this resolves.
 */
export const packagedApp = ((): string => {
  const archSuffix = process.arch === 'arm64' ? '-arm64' : '';
  switch (process.platform) {
    case 'darwin':
      return join(packageOutput, `mac${archSuffix}`, `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME);
    case 'win32':
      return join(packageOutput, `win${archSuffix}-unpacked`, `${PRODUCT_NAME}.exe`);
    default:
      return join(packageOutput, `linux${archSuffix}-unpacked`, PRODUCT_NAME.toLowerCase());
  }
})();

/**
 * A package carries its own Electron, its own `node_modules` and its own SPA, so it needs nothing from the
 * working tree — including, notably, whichever ABI `node_modules` currently holds.
 */
const packagedTarget: LaunchTarget = {
  executablePath: packagedApp,
  // The app *is* the entry point; there is no bundle to name.
  entryArgs: [],
  requires: [[packagedApp, 'the packaged Desktop App']],
  fixHint:
    'Rebuild the package with `pnpm package:desktop`. A launch that died loading a native module means the archive holds one built for the wrong ABI — `desktop:rebuild-native` runs before packaging for exactly that reason.',
};

export const test = defineDesktopTest(packagedTarget);
export { expect };
