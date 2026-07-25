// @ts-check
/**
 * Boots one Nest process serving both the API and the built SPA on a single origin
 * (ADR-0008), against a throwaway database seeded with the e2e users. Run by
 * Playwright's `webServer`; the api/web builds must exist beforehand.
 *
 * `NODE_ENV` is never `production`: the session cookie is `secure` only in production,
 * and a `secure` cookie is never set over plain http — every login would silently fail.
 * The built bundle reads `NODE_ENV` at runtime, so `test` keeps the cookie usable over
 * http://localhost.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiDist = join(workspaceRoot, 'dist', 'apps', 'api');
const mainJs = join(apiDist, 'main.js');
const seedJs = join(apiDist, 'seed.js');
const webIndex = join(workspaceRoot, 'dist', 'apps', 'web', 'browser', 'index.html');
// A throwaway Instance Directory (ADR-0036): the API derives hexly.db inside it, and
// with no hexly.yml present the Instance Configuration falls back to defaults. A per-config
// e2e run (ADR-0052, #221) points E2E_INSTANCE_DIR at its own throwaway dir so its written
// hexly.yml — and DB — never collide with the default suite's.
const instanceDir = process.env.E2E_INSTANCE_DIR ?? join(workspaceRoot, 'tmp', 'web-e2e');
const dbPath = join(instanceDir, 'hexly.db');
const configPath = join(instanceDir, 'hexly.yml');

const user = {
  email: process.env.E2E_USER_EMAIL,
  password: process.env.E2E_USER_PASSWORD,
  name: process.env.E2E_USER_NAME,
};

// A second user the suite never logs in as — it only populates the Instance user
// directory so grant/ownership specs have someone to share with (ADR-0037, #161).
const grantee = {
  email: process.env.E2E_GRANTEE_EMAIL,
  password: process.env.E2E_GRANTEE_PASSWORD,
  name: process.env.E2E_GRANTEE_NAME,
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

// The Instance Configuration this run boots against (ADR-0052, #221): write the given hexly.yml
// into the Instance Directory, or clear a stale one so an absent config means default-everything.
// This is the harness capability #221 adds — a server booted against a real, written hexly.yml.
if (process.env.E2E_CONFIG_YAML) {
  writeFileSync(configPath, process.env.E2E_CONFIG_YAML);
} else {
  rmSync(configPath, { force: true });
}

const childEnv = {
  ...process.env,
  HEXLY_DIR: instanceDir,
  // Never production (secure cookies break over http), default to test.
  NODE_ENV: !process.env.NODE_ENV || process.env.NODE_ENV === 'production' ? 'test' : process.env.NODE_ENV,
};

// Seed the e2e users before serving (synchronous: the server must not accept logins
// before the users exist). The grantee is optional — the loop skips it if unset.
// Only the login user gets a starter World: `enterLibrary` reaches its library by
// clicking a World card on the Index, so the suite is dead without one.
// E2E_SOLE_USER gives the login user the Sole User's shape (ADR-0071), so a run asserting a
// Collaboration-off absence cannot be passing on a role check instead of the flag.
const toSeed = [
  { ...user, withWorld: true, soleUser: !!process.env.E2E_SOLE_USER },
  ...(grantee.email ? [grantee] : []),
];
for (const u of toSeed) {
  const seeded = spawnSync(
    process.execPath,
    [
      seedJs,
      u.email,
      u.password,
      u.name,
      ...(u.withWorld ? ['--with-world'] : []),
      ...(u.soleUser ? ['--sole-user'] : []),
    ],
    { env: childEnv, stdio: 'inherit' },
  );
  if (seeded.error) {
    console.error('[e2e-server] Failed to spawn the seed process:', seeded.error);
    process.exit(1);
  }
  if (seeded.status !== 0) {
    console.error(`[e2e-server] Seeding the user ${u.email} failed.`);
    process.exit(seeded.status ?? 1);
  }
}

// Serve. HEXLY_E2E=1 mounts the test-reset endpoint (and only here — ADR-0009). The Deployment Profile
// (ADR-0071) has no hexly.yml key, so a run that needs `desktop` pins it through the entry point via
// E2E_PROFILE — the server honours it only under the same HEXLY_E2E allowlist.
const server = spawn(process.execPath, [mainJs], {
  env: {
    ...childEnv,
    HEXLY_E2E: '1',
    PORT: process.env.PORT ?? '3100',
    ...(process.env.E2E_PROFILE ? { HEXLY_E2E_PROFILE: process.env.E2E_PROFILE } : {}),
  },
  stdio: 'inherit',
});

const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('error', (err) => {
  console.error('[e2e-server] Failed to start the server process:', err);
  process.exit(1);
});
server.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
