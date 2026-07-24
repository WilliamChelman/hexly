/**
 * Dev-only proxy. Beyond forwarding `/api` and `/assets` to the API, it auto-authenticates the
 * browser: the app hydrates its session purely from the HttpOnly `hexly_session` cookie via
 * `GET /api/auth/me`, so logging in here once and injecting that cookie into every proxied `/api`
 * request means `nx serve web` boots already signed in — no login page in local dev.
 *
 * Credentials default to the seeded superadmin (admin@local / admin) and are env-overridable.
 * This file is loaded only by the dev server; production serves one origin (ADR-0008) and never
 * sees it.
 */

const TARGET = process.env.HEXLY_DEV_API ?? 'http://localhost:3000';
const EMAIL = process.env.HEXLY_DEV_EMAIL ?? 'admin@local';
const PASSWORD = process.env.HEXLY_DEV_PASSWORD ?? 'admin';

/** Name of the HttpOnly session cookie (mirrors SESSION_COOKIE in the API's auth.controller.ts). */
const SESSION_COOKIE = 'hexly_session';

/** Current injected cookie, e.g. `hexly_session=<token>`; empty until the first login succeeds. */
let devCookie = '';
/** Dedupes concurrent logins (startup burst, or several requests racing a 401 re-login). */
let inFlight = null;

/** Log in against the API and cache the session cookie; returns '' on any failure. */
async function login() {
  try {
    const res = await fetch(`${TARGET}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) {
      console.warn(`[dev-proxy] auto-login failed (${res.status}) for ${EMAIL} — falling back to the login page.`);
      return '';
    }
    const token = res.headers
      .getSetCookie()
      .map((c) => c.match(new RegExp(`^${SESSION_COOKIE}=([^;]+)`)))
      .find(Boolean)?.[1];
    if (!token) {
      console.warn('[dev-proxy] login succeeded but no session cookie was returned.');
      return '';
    }
    devCookie = `${SESSION_COOKIE}=${token}`;
    console.log(`[dev-proxy] auto-authenticated as ${EMAIL}.`);
    return devCookie;
  } catch {
    return '';
  }
}

/** Single-flight wrapper so a burst of callers shares one login round-trip. */
function ensureLogin() {
  if (!inFlight) inFlight = login().finally(() => (inFlight = null));
  return inFlight;
}

// Log in eagerly at startup, retrying while the API finishes booting (it starts in parallel under
// `nx run-many serve api,web`). Bounded so `serve web` alone still proceeds — just unauthenticated.
for (let attempt = 0; attempt < 30 && !devCookie; attempt++) {
  if (await ensureLogin()) break;
  await new Promise((r) => setTimeout(r, 500));
}

/** Inject the session cookie into proxied API requests and self-heal a stale session (dev DB reset). */
function configure(proxy) {
  proxy.on('proxyReq', (proxyReq) => {
    if (devCookie) proxyReq.setHeader('cookie', devCookie);
  });
  proxy.on('proxyRes', (proxyRes) => {
    // A 401 means the cached session no longer resolves (server restarted, DB reset, TTL). Refresh
    // in the background so the next request carries a fresh cookie.
    if (proxyRes.statusCode === 401) ensureLogin();
  });
}

export default {
  '/api': { target: TARGET, secure: false, configure },
  '/assets': { target: TARGET, secure: false },
};
