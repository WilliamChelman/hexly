/**
 * Out-of-band user provisioning for the closed set (ADR-0004) — there is no
 * signup endpoint, so this is how members are added. Boots a standalone Nest
 * context and delegates to the same {@link AuthService.seedUser} the tests
 * exercise. Run against the configured `HEXLY_DIR`:
 *
 *   node dist/apps/api/seed.js <email> <password> "<display name>" [--superadmin]
 *
 * `--superadmin` seeds the setup Superadmin (ADR-0037, #163) — the operator's
 * in-app self, outside the collaboration model. Seed at least one at setup so the
 * repair capability exists; every other account is a plain member.
 *
 * `--with-world` also mints a starter World owned by the new user. Off by default so
 * production provisioning stays a bare account; the e2e boot opts in so the suite's
 * World Index is never empty (its `enterLibrary` fixture picks a seeded World card).
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AuthService } from './app/auth/auth.service';
import { WorldsService } from './app/worlds/worlds.service';

async function seed() {
  const args = process.argv.slice(2);
  const isSuperadmin = args.includes('--superadmin');
  const withWorld = args.includes('--with-world');
  const [email, password, displayName] = args.filter((a) => !a.startsWith('--'));
  if (!email || !password || !displayName) {
    Logger.error(
      'Usage: seed <email> <password> <displayName> [--superadmin] [--with-world]',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const userId = await app
      .get(AuthService)
      .seedUser(email, password, displayName, { isSuperadmin, canCreateWorlds: true });
    if (withWorld) {
      app.get(WorldsService).mintWorld(userId, `${displayName}'s World`);
    }
    Logger.log(
      `Seeded ${isSuperadmin ? 'Superadmin' : 'user'} ${email}${withWorld ? ' with a starter World' : ''}`,
    );
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
