import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DeploymentProfile, DEPLOYMENT_PROFILES } from '@hexly/domain';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule, e2eTestingEnabled } from './app/app.module';
import { pinDeployment } from './app/config';

async function bootstrap() {
  // The Deployment Profile is pinned by the entry point, never by `hexly.yml` (ADR-0071), and this is
  // the server binary — so an operator cannot talk a multi-user Instance into the desktop profile.
  // Collaboration is left to `features.collaboration`; only the Desktop App pins that.
  pinDeployment({ profile: e2ePinnedProfile() ?? 'server' });
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Serve every controller under `/api` so the API namespace never collides with the web app's
  // client-side routes (the SPA owns `/maps/:id`, the API owns `/api/maps/:id`). Asset serving is
  // excluded so it stays at `/assets/...`, matching the `src` written into Content (ADR-0034, ADR-0008).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'assets/:worldId/:file', method: RequestMethod.GET }],
  });
  // Parse the session cookie off incoming requests (read by AuthController).
  app.use(cookieParser());
  // Run module shutdown hooks (DbModule closes the SQLite handle) on SIGTERM/SIGINT.
  app.enableShutdownHooks();
  // In a built deploy, this same process also serves the SPA — one origin, no
  // CORS, same-site cookies (ADR-0008).
  serveWebApp(app);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`🚀 Hexly API is running on: http://localhost:${port}`);
}

/**
 * The Deployment Profile an e2e run pins (ADR-0071), letting a browser project exercise the desktop cut
 * list without Electron. Behind the same positive allowlist that gates the test endpoints (ADR-0009), so
 * a stray env var can never put a real deploy into the desktop profile; an unrecognised value fails boot
 * rather than falling back, since a silently-wrong profile would make a run assert the wrong cut list.
 */
function e2ePinnedProfile(): DeploymentProfile | undefined {
  const value = process.env.HEXLY_E2E_PROFILE;
  if (!e2eTestingEnabled || value === undefined) return undefined;
  // Validate against the domain's own list, so a third profile never needs remembering here.
  if (!DEPLOYMENT_PROFILES.includes(value as DeploymentProfile)) {
    throw new Error(
      `Invalid HEXLY_E2E_PROFILE: ${JSON.stringify(value)} (expected ${DEPLOYMENT_PROFILES.join(' or ')})`,
    );
  }
  return value as DeploymentProfile;
}

/**
 * Serve the built Angular SPA from this same server, so the API and the app are one origin (ADR-0008).
 * The SPA bundle sits beside the API bundle in the build output (`dist/apps/api` → `dist/apps/web/browser`).
 * A no-op when that directory is absent — local dev and unit tests, where `nx serve web` owns the SPA.
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

bootstrap();
