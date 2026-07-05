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
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AuthService } from './app/auth/auth.service';

async function seed() {
  const args = process.argv.slice(2);
  const isSuperadmin = args.includes('--superadmin');
  const [email, password, displayName] = args.filter((a) => a !== '--superadmin');
  if (!email || !password || !displayName) {
    Logger.error('Usage: seed <email> <password> <displayName> [--superadmin]');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    await app
      .get(AuthService)
      .seedUser(email, password, displayName, { isSuperadmin, canCreateWorlds: true });
    Logger.log(`Seeded ${isSuperadmin ? 'Superadmin' : 'user'} ${email}`);
  } catch (err) {
    Logger.error(`Could not seed ${email}: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

seed();
