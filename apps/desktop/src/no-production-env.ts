/**
 * Clear an inherited `NODE_ENV=production` as a side effect, before anything else loads.
 *
 * `COOKIE_OPTS.secure` (auth.controller.ts) keys on that value at import time, and a `secure` cookie is
 * never stored over plain `http://127.0.0.1`, so the session would silently fail to stick: ship the
 * production *build* without the literal env value (ADR-0070). A module, not a statement in `main.ts`,
 * because imports are hoisted above statements — so import it first.
 */
if (process.env.NODE_ENV === 'production') delete process.env.NODE_ENV;
