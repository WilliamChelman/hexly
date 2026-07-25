/**
 * Out-of-band user provisioning for the closed set (ADR-0004) — there is no signup endpoint, so
 * this is how members are added. Run against the configured `HEXLY_DIR`:
 *
 *   node dist/apps/api/seed.js <email> <password> "<display name>" [--superadmin]
 *
 * `--superadmin` seeds the setup Superadmin (ADR-0037), outside the collaboration model: seed at
 * least one at setup or no account holds the repair capability. Every other account is a plain
 * member. `--sole-user` seeds the Sole User's shape instead — Superadmin holding every Instance Role
 * (ADR-0071). `--with-world` also mints a starter World owned by the new user; off by default.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { INSTANCE_ROLES } from '@hexly/domain';
import { AppModule } from './app/app.module';
import { AuthService } from './app/auth/auth.service';
import { WorldsService } from './app/worlds/worlds.service';

async function seed() {
  const args = process.argv.slice(2);
  const soleUser = args.includes('--sole-user');
  const isSuperadmin = soleUser || args.includes('--superadmin');
  const withWorld = args.includes('--with-world');
  const [email, password, displayName] = args.filter((a) => !a.startsWith('--'));
  if (!email || !password || !displayName) {
    Logger.error('Usage: seed <email> <password> <displayName> [--superadmin|--sole-user] [--with-world]');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const userId = await app.get(AuthService).seedUser(email, password, displayName, {
      isSuperadmin,
      roles: soleUser ? [...INSTANCE_ROLES] : ['create-worlds'],
    });
    if (withWorld) {
      app.get(WorldsService).mintWorld(userId, `${displayName}'s World`);
    }
    Logger.log(`Seeded ${isSuperadmin ? 'Superadmin' : 'user'} ${email}${withWorld ? ' with a starter World' : ''}`);
  } catch (err) {
    const message = (err as Error).message;
    // Idempotent boot-seed: the container runs this on every start, so an already
    // seeded email is a no-op, not a failure. Anything else is a real error.
    if (/UNIQUE constraint failed: users\.email/.test(message)) {
      Logger.log(`${email} already seeded, skipping`);
    } else {
      Logger.error(`Could not seed ${email}: ${message}`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

seed();
