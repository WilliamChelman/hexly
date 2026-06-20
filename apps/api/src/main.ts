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
  // Parse the session cookie off incoming requests (read by AuthController).
  app.use(cookieParser());
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`🚀 Hexly API is running on: http://localhost:${port}`);
}

bootstrap();
