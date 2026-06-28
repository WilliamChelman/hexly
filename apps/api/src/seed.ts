/**
 * Out-of-band user provisioning for the closed set (ADR-0004) — there is no
 * signup endpoint, so this is how members are added. Boots a standalone Nest
 * context and delegates to the same {@link AuthService.seedUser} the tests
 * exercise. Run against the configured `HEXLY_DB_PATH`:
 *
 *   node dist/apps/api/seed.js <email> <password> "<display name>"
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AuthService } from './app/auth/auth.service';
import { DB, Db, mintWorldWithHome } from './app/db/db';

async function seed() {
  const [email, password, displayName] = process.argv.slice(2);
  if (!email || !password || !displayName) {
    Logger.error('Usage: seed <email> <password> <displayName>');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const userId = await app.get(AuthService).seedUser(email, password, displayName);
    const db = app.get<Db>(DB);
    mintWorldWithHome(db.$client, userId, displayName);
    Logger.log(`Seeded user ${email}`);
  } catch (err) {
    Logger.error(`Could not seed ${email}: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

seed();
