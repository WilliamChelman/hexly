import { Logger } from '@nestjs/common';
import { DeploymentProfile, DEPLOYMENT_PROFILES } from '@hexly/domain';
import { e2eTestingEnabled } from './app/app.module';
import { pinDeployment } from './app/config';
import { createApiApp } from './host';

async function bootstrap() {
  // The entry point pins the profile, never `hexly.yml` (ADR-0071); collaboration stays a `features` knob.
  pinDeployment({ profile: e2ePinnedProfile() ?? 'server' });
  const app = await createApiApp();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`🚀 Hexly API is running on: http://localhost:${port}`);
}

/**
 * Lets an e2e run exercise the desktop profile without Electron (ADR-0071), behind the same allowlist
 * that gates the test endpoints (ADR-0009) so a stray env var cannot reprofile a real deploy.
 */
function e2ePinnedProfile(): DeploymentProfile | undefined {
  const value = process.env.HEXLY_E2E_PROFILE;
  if (!e2eTestingEnabled || value === undefined) return undefined;
  if (!DEPLOYMENT_PROFILES.includes(value as DeploymentProfile)) {
    throw new Error(
      `Invalid HEXLY_E2E_PROFILE: ${JSON.stringify(value)} (expected ${DEPLOYMENT_PROFILES.join(' or ')})`,
    );
  }
  return value as DeploymentProfile;
}

bootstrap();
