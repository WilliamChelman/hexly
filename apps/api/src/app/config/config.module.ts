import { Global, Module } from '@nestjs/common';
import { resolveInstanceDir } from '../db/db';
import { BUNDLED_PLUGIN_CONFIGS } from '../entities/bundled-plugins';
import { ClientConfigController } from './client-config.controller';
import { HEXLY_CONFIG, loadConfig } from './config';

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
      useFactory: () => loadConfig(resolveInstanceDir(), BUNDLED_PLUGIN_CONFIGS),
    },
  ],
  // The client config channel (ADR-0052) projects HEXLY_CONFIG, so it lives here.
  controllers: [ClientConfigController],
  exports: [HEXLY_CONFIG],
})
export class ConfigModule {}
