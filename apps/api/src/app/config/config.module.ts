import { Global, Module } from '@nestjs/common';
import { resolveInstanceDir } from '../db/db';
import { BUNDLED_PLUGIN_CONFIGS } from '../entities/bundled-plugins';
import { ClientConfigController } from './client-config.controller';
import { deploymentPins, HEXLY_CONFIG, loadConfig } from './config';

/**
 * Loads `hexly.yml` from the Data Directory once at boot and exposes it under
 * {@link HEXLY_CONFIG} (ADR-0036). One sync read at startup, no async DI; an
 * invalid file throws here, failing boot with the offending key named.
 */
@Global()
@Module({
  providers: [
    {
      provide: HEXLY_CONFIG,
      // Read the entry point's pins here (not at import time): the graph is composed before
      // `main.ts` states them, but resolved after (ADR-0071).
      useFactory: () => loadConfig(resolveInstanceDir(), BUNDLED_PLUGIN_CONFIGS, deploymentPins()),
    },
  ],
  // The client config channel (ADR-0052) projects HEXLY_CONFIG, so it lives here.
  controllers: [ClientConfigController],
  exports: [HEXLY_CONFIG],
})
export class ConfigModule {}
