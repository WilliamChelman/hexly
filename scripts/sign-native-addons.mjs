// @ts-check
/**
 * Ad-hoc re-sign the native addons the Desktop App loads, after an Electron rebuild. macOS only; a
 * no-op everywhere else.
 *
 * The prebuilt `better_sqlite3.node` that `electron-rebuild` installs is *linker-signed*, and macOS's
 * code-signing monitor answers Electron's `dlopen` of it with `SIGKILL (Code Signature Invalid)` — the
 * process dies mid-boot with no JS error to catch. `codesign --force --sign -` replaces that with a plain
 * ad-hoc signature, which loads. Packaging does the same thing through electron-builder; this is the dev
 * half of ADR-0070's "native modules are the packaging risk".
 *
 * Paired with `electron-rebuild --force`: its `.forge-meta` marker still claims the Electron ABI after
 * `pnpm native:node` has swapped the binary underneath, so without `--force` the rebuild is skipped and
 * the app dies on a NODE_MODULE_VERSION mismatch.
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
