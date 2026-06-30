// @ts-check
/**
 * Acquires and runs the pinned TrailBase server binary (ADR-0032). TrailBase
 * ships as a single executable, so rather than a Docker dependency we download
 * the platform's prebuilt release once into a gitignored cache and reuse it from
 * both dev (`pnpm dev:api`) and e2e (`e2e-server.mjs`).
 *
 * Usage:
 *   node scripts/trailbase.mjs <trail args...>   # ensures the binary, then execs it
 *   import { ensureTrailbase } from './trailbase.mjs'  # returns the binary path
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, platform } from 'node:os';

// Pinned to the version the #127 spike validated; bump deliberately.
const VERSION = 'v0.29.0';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.trailbase', VERSION);

/** Maps the host to its release asset + extracted binary name. */
function target() {
  const a = arch();
  const p = platform();
  const cpu = a === 'arm64' ? 'arm64' : 'x86_64';
  if (p === 'darwin') return { asset: `trailbase_${VERSION}_${cpu}_apple_darwin.zip`, bin: 'trail' };
  if (p === 'linux') return { asset: `trailbase_${VERSION}_${cpu}_linux.zip`, bin: 'trail' };
  if (p === 'win32') return { asset: `trailbase_${VERSION}_x86_64_windows.zip`, bin: 'trail.exe' };
  throw new Error(`[trailbase] Unsupported platform ${p}/${a}`);
}

/**
 * Returns the path to the TrailBase binary, downloading and unzipping it on
 * first use. Idempotent: a present binary short-circuits the download.
 */
export function ensureTrailbase() {
  const { asset, bin } = target();
  const binPath = join(cacheDir, bin);
  if (existsSync(binPath)) return binPath;

  mkdirSync(cacheDir, { recursive: true });
  const url = `https://github.com/trailbaseio/trailbase/releases/download/${VERSION}/${asset}`;
  const zipPath = join(cacheDir, asset);

  console.error(`[trailbase] Downloading ${VERSION} for this platform…`);
  const dl = spawnSync('curl', ['-fSL', '--retry', '3', '-o', zipPath, url], { stdio: 'inherit' });
  if (dl.status !== 0) throw new Error(`[trailbase] Download failed: ${url}`);

  // ponytail: `unzip` (mac/linux) and Windows `tar` (bsdtar) both handle zip;
  // swap to a node unzip lib only if a host without either shows up.
  const unzip = platform() === 'win32'
    ? spawnSync('tar', ['-xf', zipPath, '-C', cacheDir], { stdio: 'inherit' })
    : spawnSync('unzip', ['-oq', zipPath, bin, '-d', cacheDir], { stdio: 'inherit' });
  if (unzip.status !== 0) throw new Error('[trailbase] Unzip failed (need `unzip` on PATH).');

  spawnSync('chmod', ['+x', binPath]);
  return binPath;
}

// CLI: `node scripts/trailbase.mjs run -a ...` → ensure then exec `trail run -a ...`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const bin = ensureTrailbase();
  const child = spawn(bin, process.argv.slice(2), { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
