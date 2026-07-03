import { Global, Module } from '@nestjs/common';
import { resolveInstanceDir } from '../db/db';
import { HexlyConfig, loadConfig } from './config';

/** DI token for the loaded Instance Configuration (ADR-0036). */
export const HEXLY_CONFIG = Symbol('HEXLY_CONFIG');

/**
 * Loads `hexly.yml` from the Data Directory once at boot and exposes it under
 * {@link HEXLY_CONFIG} (ADR-0036). Marked `@Global()` so any module — including
 * `MulterModule.registerAsync` for the upload limit — can inject it without
 * re-importing. Mirrors {@link DbModule}: one sync read at startup, no async DI.
 * An invalid file throws here, failing boot with the offending key named.
 */
@Global()
@Module({
  providers: [{ provide: HEXLY_CONFIG, useFactory: () => loadConfig(resolveInstanceDir()) }],
  exports: [HEXLY_CONFIG],
})
export class ConfigModule {}

export type { HexlyConfig };
