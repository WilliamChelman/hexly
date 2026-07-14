import { Global, Module } from '@nestjs/common';
import { resolveInstanceDir } from '../db/db';
import { BUNDLED_PLUGIN_CONFIGS } from '../entities/bundled-plugins';
import { HexlyConfig, loadConfig } from './config';

/** DI token for the loaded Instance Configuration (ADR-0036). */
export const HEXLY_CONFIG = Symbol('HEXLY_CONFIG');

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
  exports: [HEXLY_CONFIG],
})
export class ConfigModule {}

export type { HexlyConfig };
