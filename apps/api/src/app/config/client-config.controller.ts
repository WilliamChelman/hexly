import { Controller, Get, Inject } from '@nestjs/common';
import { ClientConfig } from '@hexly/domain';
import { HexlyConfig, HEXLY_CONFIG } from './config';

/**
 * The client config channel (ADR-0052, Seam 4): an unauthenticated `GET /api/config` projecting the
 * loaded {@link HexlyConfig} down to the client-visible subset. No `@UseGuards` — a session-less browser
 * reads the enabled-Plugin set at boot, before it has a session.
 */
@Controller()
export class ClientConfigController {
  constructor(@Inject(HEXLY_CONFIG) private readonly config: HexlyConfig) {}

  @Get('config')
  getConfig(): ClientConfig {
    return {
      // `features.plugin` has an entry per bundled Plugin (the schema prefaults one); only `enabled`
      // crosses to the client.
      plugins: Object.fromEntries(
        Object.entries(this.config.features.plugin).map(([id, plugin]) => [id, { enabled: plugin.enabled }]),
      ),
      entities: { defaultType: this.config.entities.defaultType },
    };
  }
}
