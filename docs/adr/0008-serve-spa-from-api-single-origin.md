# Serve the SPA from the API as a single origin

In production the Nest **api** serves the built Angular **web** SPA's static files itself: `/api/*` is handled by the controllers (the global prefix set in `main.ts`), and *everything else* falls through to the SPA's static assets with an `index.html` fallback for client-side routes. The deployable is therefore **one process on one origin** — `dist/apps/web` served by the same Nest server that owns `/api`. This makes the design intent already written into `main.ts` ("one reverse-proxy/static-host split — `/api` to this server, everything else to the SPA") concrete, and chooses *the api itself* as that host rather than a separate one.

Dev is unchanged and remains split: `nx serve web` keeps HMR and uses `proxy.conf.json` to forward `/api` to `nx serve api`. Only prod and e2e use the api-serves-SPA path. This is a deliberate, small dev/prod delta.

## Considered Options

**A separate gateway/BFF/edge app** (an nginx or node process) that serves the SPA statics and reverse-proxies `/api` to Nest. Rejected for now: it is a third thing to build, deploy, and keep faithful, and it reintroduces a proxy hop — more architecture than a single-SQLite-file app at this stage needs. It only earns its keep once static traffic or independent scaling of web vs api actually hurts.

**Two separate origins (web host + api host) with CORS.** Rejected: it would require adding CORS the app deliberately does *not* have (no `app.enableCors()`), and it breaks the same-origin assumption the session cookie relies on (`sameSite: 'lax'`). It is also *less* faithful to the intended deployment than a single origin, not more.

## Consequences

- **Same-origin cookies work by construction.** The `hexly_session` cookie (`httpOnly`, `sameSite: 'lax'`) needs no cross-site relaxation; there is no CORS surface to secure.
- **E2E tests the real prod artifact.** Playwright's `webServer` boots a single Nest process (after `nx build web` lands the SPA where Nest serves it) and tests hit one port — the harness *is* the prod topology, not a stand-in. No separate proxy script is maintained.
- **Build coupling.** A prod/e2e build must produce `dist/apps/web` before (or as part of) starting the api; the api needs the SPA assets present at runtime.
- **`secure` cookies vs http e2e.** `secure` is gated on `NODE_ENV === 'production'`, and `secure` cookies are not set over plain `http://localhost`. E2E therefore runs the prod *build* without literal `NODE_ENV=production` (or over https) so login cookies are set — resolved separately in the e2e setup.
- **Not locked out of an edge layer.** A CDN/reverse proxy can later front this single origin (cache statics, pass `/api` through) with no app code change; the gateway app remains available if scale demands it.
