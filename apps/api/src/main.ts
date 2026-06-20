/**
 * Minimal NestJS bootstrap for the Hexly API.
 * Exposes the routes defined by its controllers (e.g. `GET /health`).
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Serve every controller under `/api` so the API namespace never collides
  // with the web app's client-side routes (e.g. the SPA owns `/maps/:id` while
  // the API owns `/api/maps/:id`). One reverse-proxy/static-host split — `/api`
  // to this server, everything else to the SPA — works in dev and prod alike.
  app.setGlobalPrefix('api');
  // Parse the session cookie off incoming requests (read by AuthController).
  app.use(cookieParser());
  // Run module shutdown hooks (DbModule closes the SQLite handle) on SIGTERM/SIGINT.
  app.enableShutdownHooks();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`🚀 Hexly API is running on: http://localhost:${port}`);
}

bootstrap();
