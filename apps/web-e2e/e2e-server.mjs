// @ts-check
/**
 * Boots the app the way a production deploy does — one Nest process serving both
 * the API and the built SPA on a single origin (ADR-0008) — but pointed at a
 * throwaway database seeded with the one e2e user. Playwright's `webServer` runs
 * this and waits for the port; the api/web builds are produced beforehand by the
 * `e2e` target's `dependsOn` (ADR-0009).
 *
 * Why `NODE_ENV` is not `production`: the session cookie is `secure` only in
 * production, and a `secure` cookie is never set over plain http — which would
 * silently break every login. The built bundle reads `NODE_ENV` at runtime, so
 * launching it as `test` keeps the cookie usable over http://localhost.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiDist = join(workspaceRoot, 'dist', 'apps', 'api');
const mainJs = join(apiDist, 'main.js');
const seedJs = join(apiDist, 'seed.js');
const webIndex = join(workspaceRoot, 'dist', 'apps', 'web', 'browser', 'index.html');
const dbPath = join(workspaceRoot, 'tmp', 'web-e2e', 'hexly-e2e.db');

const user = {
  email: process.env.E2E_USER_EMAIL,
  password: process.env.E2E_USER_PASSWORD,
  name: process.env.E2E_USER_NAME,
};

/** Fail loudly with a fix-it hint rather than a cryptic ENOENT mid-run. */
function requireBuilt(path, what) {
  if (!existsSync(path)) {
    console.error(
      `[e2e-server] Missing ${what} (${path}). Build first: \`nx build api\` and \`nx build web\`, or run via \`nx e2e web-e2e\`.`,
    );
    process.exit(1);
  }
}

requireBuilt(mainJs, 'API build');
requireBuilt(seedJs, 'seed build');
requireBuilt(webIndex, 'web build');

// Credentials come from playwright.config.ts (sourced from test-user.ts); fail
// loud if they're missing rather than silently re-hardcoding drifting literals.
if (!user.email || !user.password || !user.name) {
  console.error(
    '[e2e-server] Missing E2E_USER_EMAIL/E2E_USER_PASSWORD/E2E_USER_NAME (set by playwright.config.ts from test-user.ts).',
  );
  process.exit(1);
}

// Start from a clean database every run, so a run never inherits stale state
// (and never touches the real hexly.db).
mkdirSync(dirname(dbPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });

const childEnv = {
  ...process.env,
  HEXLY_DB_PATH: dbPath,
  // Never production (secure cookies break over http), default to test.
  NODE_ENV: !process.env.NODE_ENV || process.env.NODE_ENV === 'production' ? 'test' : process.env.NODE_ENV,
};

// Seed the one e2e user before serving (synchronous: the server must not accept
// logins before the user exists).
const seeded = spawnSync(
  process.execPath,
  [seedJs, user.email, user.password, user.name],
  { env: childEnv, stdio: 'inherit' },
);
if (seeded.error) {
  console.error('[e2e-server] Failed to spawn the seed process:', seeded.error);
  process.exit(1);
}
if (seeded.status !== 0) {
  console.error('[e2e-server] Seeding the test user failed.');
  process.exit(seeded.status ?? 1);
}

// Serve. HEXLY_E2E=1 mounts the test-reset endpoint (and only here — ADR-0009).
const server = spawn(process.execPath, [mainJs], {
  env: { ...childEnv, HEXLY_E2E: '1', PORT: process.env.PORT ?? '3100' },
  stdio: 'inherit',
});

const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('error', (err) => {
  console.error('[e2e-server] Failed to start the server process:', err);
  process.exit(1);
});
server.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
