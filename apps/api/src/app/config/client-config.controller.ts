import { Controller, Get, Inject } from '@nestjs/common';
import { ClientConfig, ClientPluginConfig } from '@hexly/domain';
import { HexlyConfig, HEXLY_CONFIG } from './config';

/**
 * Project one Plugin's server config to its client-visible subset (ADR-0052): `enabled` always, plus the
 * whitelisted client knobs it declares. Only the Board's `maxEmbedDepth` (ADR-0062) crosses today; every
 * other per-Plugin server knob is dropped.
 */
function projectPlugin(plugin: HexlyConfig['features']['plugin'][string]): ClientPluginConfig {
  const maxEmbedDepth = (plugin as { maxEmbedDepth?: number }).maxEmbedDepth;
  return maxEmbedDepth === undefined ? { enabled: plugin.enabled } : { enabled: plugin.enabled, maxEmbedDepth };
}

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
      // `features.plugin` has an entry per bundled Plugin (the schema prefaults one); `enabled` always
      // crosses, and the whitelisted client knobs a Plugin declares (the Board's `maxEmbedDepth`,
      // ADR-0062) ride alongside — every other server-only knob stays server-side.
      plugins: Object.fromEntries(
        Object.entries(this.config.features.plugin).map(([id, plugin]) => [id, projectPlugin(plugin)]),
      ),
      entities: { defaultType: this.config.entities.defaultType },
    };
  }
}
