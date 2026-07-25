// @ts-check
/**
 * Ad-hoc re-sign the native addons the Desktop App loads, after an Electron rebuild. macOS only; a no-op
 * everywhere else. The prebuilt `better_sqlite3.node` `electron-rebuild` installs is linker-signed, and
 * macOS answers Electron's `dlopen` of it with `SIGKILL (Code Signature Invalid)` — no JS error to catch;
 * an ad-hoc signature loads (ADR-0070, the dev half of what electron-builder does at packaging).
 *
 * Paired with `electron-rebuild --force`: its `.forge-meta` marker still claims the Electron ABI after
 * `pnpm native:node` swapped the binary underneath, so without `--force` the rebuild is skipped.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.platform !== 'darwin') process.exit(0);

const require = createRequire(import.meta.url);
// `require.resolve` lands on `lib/index.js`; two levels up is the package root, wherever pnpm put it.
const packageRoot = dirname(dirname(require.resolve('better-sqlite3')));
const addon = join(packageRoot, 'build', 'Release', 'better_sqlite3.node');

if (!existsSync(addon)) {
  console.error(`[sign-native] No addon at ${addon} — run \`pnpm native:electron\` first.`);
  process.exit(1);
}

execFileSync('codesign', ['--force', '--sign', '-', addon], { stdio: 'inherit' });
console.log(`[sign-native] ad-hoc signed ${addon}`);
