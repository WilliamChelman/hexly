import { Test } from '@nestjs/testing';
import { ClientConfig } from '@hexly/domain';
import { ClientConfigController } from './client-config.controller';
import { HexlyConfig, HEXLY_CONFIG } from './config';

/** A HexlyConfig whose only interesting parts are the two the client channel projects. */
function configWith(plugin: HexlyConfig['features']['plugin'], defaultType: string): HexlyConfig {
  return {
    import: { maxUpload: 0, maxDecompressed: 0, strictZipGuard: false },
    search: { weights: { name: 10, tags: 5, content: 1 } },
    liveFollow: { heartbeatSeconds: 30 },
    features: { plugin: plugin },
    entities: { defaultType },
  };
}

async function controllerFor(config: HexlyConfig): Promise<ClientConfigController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ClientConfigController],
    providers: [{ provide: HEXLY_CONFIG, useValue: config }],
  }).compile();
  return moduleRef.get(ClientConfigController);
}

describe('ClientConfigController', () => {
  it('projects each Plugin enabled state and the default type from HexlyConfig', async () => {
    const controller = await controllerFor(
      configWith({ content: { enabled: true }, hexmap: { enabled: false }, dnd: { enabled: true } }, 'core.note'),
    );

    const client: ClientConfig = controller.getConfig();

    expect(client).toEqual({
      plugins: {
        content: { enabled: true },
        hexmap: { enabled: false },
        dnd: { enabled: true },
      },
      entities: { defaultType: 'core.note' },
    });
  });

  it('projects only `enabled`, dropping any other per-Plugin knobs the server holds', async () => {
    const controller = await controllerFor(
      // A Plugin's server-side config may carry extra knobs beyond `enabled`; the client channel
      // exposes only enablement.
      configWith({ dnd: { enabled: true, someServerKnob: 'x' } as never }, 'dnd.monster'),
    );

    expect(controller.getConfig().plugins).toEqual({ dnd: { enabled: true } });
  });

  it('crosses a Plugin-declared client knob (the Board `maxEmbedDepth`) alongside `enabled`', async () => {
    const controller = await controllerFor(
      configWith({ board: { enabled: true, maxEmbedDepth: 5 } as never }, 'core.board'),
    );

    expect(controller.getConfig().plugins).toEqual({ board: { enabled: true, maxEmbedDepth: 5 } });
  });

  it('carries whatever `entities.defaultType` the config resolved, verbatim', async () => {
    const controller = await controllerFor(configWith({}, 'world.deity'));

    expect(controller.getConfig().entities.defaultType).toBe('world.deity');
  });
});
