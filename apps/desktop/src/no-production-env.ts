/**
 * Clear an inherited `NODE_ENV=production` as a side effect, before anything else loads: `COOKIE_OPTS.secure`
 * (auth.controller.ts) keys on it at import time, and a `secure` cookie is never stored over plain
 * `http://127.0.0.1` (ADR-0070). A module rather than a statement in `main.ts`, since imports are hoisted.
 */
if (process.env.NODE_ENV === 'production') delete process.env.NODE_ENV;
