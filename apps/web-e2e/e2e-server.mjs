// @ts-check
/**
 * Boots the app the way a production deploy does — a single TrailBase process
 * serving the built SPA and the API on one origin (ADR-0008, ADR-0032) — but
 * against a throwaway depot seeded with the one e2e user. Playwright's
 * `webServer` runs this and waits for the port; the web build is produced
 * beforehand by the `e2e` target's `dependsOn` (ADR-0009).
 *
 * The closed user set (ADR-0004) is reproduced exactly: the user is seeded with
 * password auth enabled (`trail user add`), then the committed config —
 * `disable_password_auth: true` — is applied so `/register` is rejected while the
 * seeded user still logs in.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTrailbase } from '../../scripts/trailbase.mjs';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = join(workspaceRoot, 'dist', 'apps', 'web', 'browser');
const webIndex = join(webDir, 'index.html');
const committedConfig = join(workspaceRoot, 'traildepot', 'config.textproto');
const committedMigrations = join(workspaceRoot, 'traildepot', 'migrations');
const depot = join(workspaceRoot, 'tmp', 'web-e2e', 'traildepot');
const port = process.env.PORT ?? '3100';

// TrailBase has no display name; the seeded user logs in with email + password.
const user = { email: process.env.E2E_USER_EMAIL, password: process.env.E2E_USER_PASSWORD };

/** Fail loudly with a fix-it hint rather than a cryptic error mid-run. */
function requireBuilt(path, what) {
  if (!existsSync(path)) {
    console.error(
      `[e2e-server] Missing ${what} (${path}). Build first: \`nx build web\`, or run via \`nx e2e web-e2e\`.`,
    );
    process.exit(1);
  }
}

/** Run a trail subcommand against the throwaway depot; abort on failure. */
function trailSync(bin, args) {
  const res = spawnSync(bin, ['--data-dir', depot, ...args], { stdio: 'inherit' });
  if (res.error) {
    console.error(`[e2e-server] Failed to spawn trail ${args[0]}:`, res.error);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[e2e-server] \`trail ${args.join(' ')}\` failed.`);
    process.exit(res.status ?? 1);
  }
}

requireBuilt(webIndex, 'web build');

if (!user.email || !user.password) {
  console.error('[e2e-server] Missing E2E_USER_EMAIL/E2E_USER_PASSWORD (set by playwright.config.ts).');
  process.exit(1);
}

const trail = ensureTrailbase();

// Start from a clean depot every run, so a run never inherits stale state.
rmSync(depot, { recursive: true, force: true });
mkdirSync(depot, { recursive: true });

// 0. Stage the committed migrations so the bootstrap applies the Worlds/Entities
//    schema (#129). They must be in place before the depot bootstraps below.
cpSync(committedMigrations, join(depot, 'migrations'), { recursive: true });
// 1. Seed the verified e2e user. This also bootstraps the depot (default config,
//    migrations, admin) — with password auth on, so the credential is usable.
trailSync(trail, ['user', 'add', user.email, user.password]);
// 2. Apply the closed-set config (disables /register; existing user still logs in).
cpSync(committedConfig, join(depot, 'config.textproto'));

// 3. Serve the SPA + API on a single origin. `--spa` falls index.html back for
//    client routes; `/api` and `/_` stay owned by TrailBase.
const server = spawn(
  trail,
  ['run', '-a', `localhost:${port}`, '--public-dir', webDir, '--spa'],
  { env: { ...process.env, DATA_DIR: depot }, stdio: 'inherit' },
);

const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('error', (err) => {
  console.error('[e2e-server] Failed to start TrailBase:', err);
  process.exit(1);
});
server.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
