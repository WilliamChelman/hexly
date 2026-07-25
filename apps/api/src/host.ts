/**
 * What an *embedding* entry point needs to host this API in its own process. The Desktop App's
 * Electron main boots the same `AppModule` and points a window at it (ADR-0070), so the wiring both
 * entry points share — the `/api` prefix, the cookie parser, the shutdown hooks, the SPA served over
 * HTTP — lives here instead of being restated (and drifting) in two mains. Listening is deliberately
 * *not* here: the port and interface are the one thing the two entry points genuinely disagree about.
 *
 * Kept to a single file so the one cross-project import the desktop needs is one waived path, rather
 * than a lib extracted for a single consumer.
 */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app/app.module';
import { loopbackOnly } from './loopback-only';

// The deployment pins an entry point states before the graph resolves (ADR-0071), and the credential
// -free session primitives an embedder mints the Sole User's session with (ADR-0070).
export { pinDeployment } from './app/config';
export type { DeploymentPins } from './app/config';
export { AuthService } from './app/auth/auth.service';
export { SESSION_COOKIE } from './app/auth/auth.controller';
// The resolved Assets root (ADR-0034), so an embedder that offers to *move* those bytes (#326) reads the same
// truth every consumer does rather than re-deriving `assets.dir` against the Instance Directory.
export { ASSETS_DIR } from './app/assets/assets.service';

/** What an entry point decides about the app itself, as opposed to where it listens. */
export interface ApiAppOptions {
  /**
   * Turn on the DNS-rebinding wall (`loopback-only.ts`). The Desktop App does, being the only caller of
   * its own socket; a server serves whatever hostname its operator points at it, so it must not.
   */
  readonly loopbackOnly?: boolean;
}

/**
 * Create the Nest app with everything both entry points want, ready to `listen`. The caller pins its
 * {@link DeploymentPins} *before* calling this: the graph is composed at import time but resolved
 * here (ADR-0071).
 *
 * There is no `enableCors()` here, and **its absence is load-bearing** — it is the second of the two walls
 * that make the Desktop App's loopback socket acceptable (ADR-0008, ADR-0070).
 */
export async function createApiApp(options: ApiAppOptions = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Before every other middleware, so a rebound request reaches neither a controller nor the SPA below.
  if (options.loopbackOnly) app.use(loopbackOnly());
  // Serve every controller under `/api` so the API namespace never collides with the web app's
  // client-side routes (the SPA owns `/maps/:id`, the API owns `/api/maps/:id`). Asset serving is
  // excluded so it stays at `/assets/...`, matching the `src` written into Content (ADR-0034, ADR-0008).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'assets/:worldId/:file', method: RequestMethod.GET }],
  });
  // Parse the session cookie off incoming requests (read by AuthController).
  app.use(cookieParser());
  // Run module shutdown hooks (DbModule closes the SQLite handle) on SIGTERM/SIGINT — and on the
  // `app.close()` an embedder awaits before its own process exits.
  app.enableShutdownHooks();
  // In a built deploy, this same process also serves the SPA — one origin, no
  // CORS, same-site cookies (ADR-0008).
  serveWebApp(app);
  return app;
}

/**
 * Serve the built Angular SPA from this same server, so the API and the app are one origin (ADR-0008).
 * The SPA bundle sits beside the hosting bundle in the build output (`dist/apps/{api,desktop}` →
 * `dist/apps/web/browser`). A no-op when that directory is absent — local dev and unit tests, where
 * `nx serve web` owns the SPA.
 */
function serveWebApp(app: NestExpressApplication): void {
  const webRoot = join(__dirname, '..', 'web', 'browser');
  const indexHtml = join(webRoot, 'index.html');
  // Bail to a no-op unless the SPA bundle is fully present: the build dir AND the
  // shell it serves. Without `index.html` every client route would 500 in
  // `res.sendFile`, so a missing shell means we leave the SPA fallback off.
  if (!existsSync(webRoot) || !existsSync(indexHtml)) return;

  // Real, hashed assets (JS/CSS/images) are served straight from disk. `index`
  // is off so the SPA-fallback below — not express.static — owns "/" and every
  // client route, keeping a single source of the shell.
  app.useStaticAssets(webRoot, { index: false });

  app.use((req: Request, res: Response, next: NextFunction) => {
    // Hand back to the API and to missing-asset 404s; serve the SPA shell for
    // every other GET so a deep link or reload of a client route (e.g.
    // `/maps/:id`) boots the app instead of 404-ing. Match the `/api` segment
    // exactly (not a `startsWith` prefix, which would swallow `/apiary`,
    // `/api-docs`, …). `extname` lets a missing asset 404 rather than return
    // HTML — known limit: a client route whose last segment has a dot is treated
    // as an asset and 404s, acceptable since map ids/routes are `[\w-]+` (no dots).
    if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/') || extname(req.path)) {
      return next();
    }
    res.sendFile(indexHtml);
  });
}
