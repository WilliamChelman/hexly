import { Logger } from '@nestjs/common';
import { DeploymentProfile, DEPLOYMENT_PROFILES } from '@hexly/domain';
import { e2eTestingEnabled } from './app/app.module';
import { pinDeployment } from './app/config';
import { createApiApp } from './host';

async function bootstrap() {
  // The Deployment Profile is pinned by the entry point, never by `hexly.yml` (ADR-0071), and this is
  // the server binary — so an operator cannot talk a multi-user Instance into the desktop profile.
  // Collaboration is left to `features.collaboration`; only the Desktop App pins that.
  pinDeployment({ profile: e2ePinnedProfile() ?? 'server' });
  const app = await createApiApp();
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

bootstrap();
