import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { authFileFor } from './src/auth-file';
import { TEST_GRANTEE, TEST_USER } from './src/test-user';

// `__dirname` (not `import.meta`) because Playwright loads this config as CommonJS.
const workspaceRoot = join(__dirname, '..', '..');
// A dedicated base port so e2e never collides with (or accidentally reuses) a `pnpm
// dev` server on 3000 — that server has a different, unseeded DB. The per-config runs
// (#221) take the next ports up, so each Instance Configuration gets its own server.
const basePort = Number(process.env.E2E_PORT ?? '3100');
const urlFor = (port: number) => `http://localhost:${port}`;

// Each per-config run (ADR-0052, #221) boots its own server against a written hexly.yml. `port`
// isolates it; `instanceSubdir` gives it a throwaway Instance Directory; `configYaml`, when present,
// is written as that dir's hexly.yml before boot (an absent one means default-everything).
const DEFAULT_PORT = basePort;
const PLUGIN_DISABLED_PORT = basePort + 1;
const DEFAULT_TYPE_PORT = basePort + 2;
const COLLAB_OFF_PORT = basePort + 3;

// dnd off: its Types degrade to the generic Field View, values intact (ADR-0052).
const DISABLE_DND_YAML = ['features:', '  plugin:', '    dnd:', '      enabled: false', ''].join('\n');
// The "New" button mints a Hex Map by default — an enabled non-note Type (ADR-0052).
const DEFAULT_HEXMAP_YAML = ['entities:', '  defaultType: core.type.hex-map', ''].join('\n');
// Collaboration off (ADR-0071): the solo self-hoster — still a server profile, so it keeps its login page.
const COLLABORATION_OFF_YAML = ['features:', '  collaboration: false', ''].join('\n');

/** One `e2e-server.mjs` invocation: its own port, throwaway Instance Directory, and optional hexly.yml. */
function server(port: number, opts: { instanceSubdir?: string; configYaml?: string; soleUser?: boolean } = {}) {
  return {
    command: 'node apps/web-e2e/e2e-server.mjs',
    url: urlFor(port),
    cwd: workspaceRoot,
    // Always start a fresh server so each run gets a freshly seeded throwaway DB;
    // opt into reuse locally (never in CI) with E2E_REUSE_SERVER=1 for fast iteration.
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE_SERVER === '1',
    timeout: 120_000,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
    env: {
      PORT: String(port),
      E2E_USER_EMAIL: TEST_USER.email,
      E2E_USER_PASSWORD: TEST_USER.password,
      E2E_USER_NAME: TEST_USER.displayName,
      // A second directory user for grant/ownership specs to share with (#161).
      E2E_GRANTEE_EMAIL: TEST_GRANTEE.email,
      E2E_GRANTEE_PASSWORD: TEST_GRANTEE.password,
      E2E_GRANTEE_NAME: TEST_GRANTEE.displayName,
      ...(opts.instanceSubdir ? { E2E_INSTANCE_DIR: join(workspaceRoot, 'tmp', opts.instanceSubdir) } : {}),
      ...(opts.configYaml ? { E2E_CONFIG_YAML: opts.configYaml } : {}),
      // The Sole User's shape: Superadmin holding every Instance Role (ADR-0071).
      ...(opts.soleUser ? { E2E_SOLE_USER: '1' } : {}),
    },
  };
}

/** A logged-in browser project bound to one server: its baseURL and the session that server minted. */
function authenticated(name: string, port: number, extra: { testMatch?: RegExp; testIgnore?: RegExp } = {}) {
  return {
    name,
    use: { ...devices['Desktop Chrome'], baseURL: urlFor(port), storageState: authFileFor(String(port)) },
    dependencies: [`setup-${name}`],
    ...extra,
  };
}

/** The setup project that logs into `port`'s server and persists its session (ADR-0009). */
function setup(name: string, port: number) {
  return { name: `setup-${name}`, testMatch: /.*\.setup\.ts/, use: { baseURL: urlFor(port) } };
}

/**
 * E2E runs against the real production build on a single origin (ADR-0008, ADR-0009):
 * `e2e-server.mjs` seeds a throwaway DB and boots one Nest process that serves both the API and the
 * built SPA. Serial (`workers: 1`) because each server shares one DB and resets it between tests via
 * a global endpoint. The default suite runs against a config-less server; the per-config runs (#221)
 * add their own servers, each booted against a written hexly.yml, and their own login/session.
 */
export default defineConfig({
  testDir: join(__dirname, 'src'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: urlFor(DEFAULT_PORT),
    trace: 'on-first-retry',
  },
  projects: [
    // The default suite: a config-less server, every Plugin enabled (opt-out default).
    setup('chromium', DEFAULT_PORT),
    authenticated('chromium', DEFAULT_PORT, { testIgnore: /.*[/\\]config[/\\].*/ }),
    // dnd disabled (ADR-0052): a run proving a disabled Plugin degrades gracefully end-to-end.
    setup('plugin-disabled', PLUGIN_DISABLED_PORT),
    authenticated('plugin-disabled', PLUGIN_DISABLED_PORT, {
      testMatch: /.*[/\\]config[/\\]plugin-disabled\.spec\.ts/,
    }),
    // entities.defaultType set to core.type.hex-map (ADR-0052): the primary create button follows it.
    setup('default-type', DEFAULT_TYPE_PORT),
    authenticated('default-type', DEFAULT_TYPE_PORT, {
      testMatch: /.*[/\\]config[/\\]default-type\.spec\.ts/,
    }),
    // features.collaboration off (ADR-0071, #316, #317): a run proving the Entity and World sharing
    // surfaces and instance user management are gone, and the routes behind them 404 — driven by a
    // Sole-User-shaped account, so no Instance Role check can be doing the hiding.
    setup('collab-off', COLLAB_OFF_PORT),
    authenticated('collab-off', COLLAB_OFF_PORT, {
      testMatch: /.*[/\\]config[/\\]collab-off\.spec\.ts/,
    }),
  ],
  webServer: [
    server(DEFAULT_PORT),
    server(PLUGIN_DISABLED_PORT, { instanceSubdir: 'web-e2e-plugin-disabled', configYaml: DISABLE_DND_YAML }),
    server(DEFAULT_TYPE_PORT, { instanceSubdir: 'web-e2e-default-type', configYaml: DEFAULT_HEXMAP_YAML }),
    server(COLLAB_OFF_PORT, {
      instanceSubdir: 'web-e2e-collab-off',
      configYaml: COLLABORATION_OFF_YAML,
      soleUser: true,
    }),
  ],
});
