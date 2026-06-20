/**
 * Minimal NestJS bootstrap for the Hexly API.
 * Exposes the routes defined by its controllers (e.g. `GET /health`).
 */

import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Serve every controller under `/api` so the API namespace never collides
  // with the web app's client-side routes (e.g. the SPA owns `/maps/:id` while
  // the API owns `/api/maps/:id`). One reverse-proxy/static-host split — `/api`
  // to this server, everything else to the SPA — works in dev and prod alike.
  app.setGlobalPrefix('api');
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
 * Serve the built Angular SPA from this same server, so the API and the app are
 * one origin (ADR-0008). The SPA bundle sits beside the API bundle in the build
 * output (`dist/apps/api` → `dist/apps/web/browser`). When that directory is
 * absent — local dev and unit tests, where `nx serve web` owns the SPA — this is
 * a no-op, so nothing changes for the split dev setup.
 */
function serveWebApp(app: NestExpressApplication): void {
  const webRoot = join(__dirname, '..', 'web', 'browser');
  if (!existsSync(webRoot)) return;

  // Real, hashed assets (JS/CSS/images) are served straight from disk. `index`
  // is off so the SPA-fallback below — not express.static — owns "/" and every
  // client route, keeping a single source of the shell.
  app.useStaticAssets(webRoot, { index: false });

  const indexHtml = join(webRoot, 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Hand back to the API and to missing-asset 404s; serve the SPA shell for
    // every other GET so a deep link or reload of a client route (e.g.
    // `/maps/:id`) boots the app instead of 404-ing.
    if (req.method !== 'GET' || req.path.startsWith('/api') || extname(req.path)) {
      return next();
    }
    res.sendFile(indexHtml);
  });
}

bootstrap();
