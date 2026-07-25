import { Test } from '@nestjs/testing';
import { ClientConfig, DeploymentProfile } from '@hexly/domain';
import { ClientConfigController } from './client-config.controller';
import { HexlyConfig, HEXLY_CONFIG } from './config';

/** A HexlyConfig whose only interesting parts are the ones the client channel projects. */
function configWith(
  plugin: HexlyConfig['features']['plugin'],
  defaultType: string,
  deployment: { profile?: DeploymentProfile; collaboration?: boolean } = {},
): HexlyConfig {
  return {
    profile: deployment.profile ?? 'server',
    import: { maxUpload: 0, maxDecompressed: 0, strictZipGuard: false },
    assets: {},
    search: { weights: { name: 10, tags: 5, content: 1 } },
    liveFollow: { heartbeatSeconds: 30 },
    features: { plugin: plugin, collaboration: deployment.collaboration ?? true },
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
      configWith({ content: { enabled: true }, hexmap: { enabled: false }, dnd: { enabled: true } }, 'core.type.note'),
    );

    const client: ClientConfig = controller.getConfig();

    expect(client).toEqual({
      profile: 'server',
      collaboration: true,
      plugins: {
        content: { enabled: true },
        hexmap: { enabled: false },
        dnd: { enabled: true },
      },
      entities: { defaultType: 'core.type.note' },
    });
  });

  it('projects only `enabled`, dropping any other per-Plugin knobs the server holds', async () => {
    const controller = await controllerFor(
      // A Plugin's server-side config may carry extra knobs beyond `enabled`; the client channel
      // exposes only enablement.
      configWith({ dnd: { enabled: true, someServerKnob: 'x' } as never }, 'dnd.type.monster'),
    );

    expect(controller.getConfig().plugins).toEqual({ dnd: { enabled: true } });
  });

  it('crosses a Plugin-declared client knob (the Board `maxEmbedDepth`) alongside `enabled`', async () => {
    const controller = await controllerFor(
      configWith({ board: { enabled: true, maxEmbedDepth: 5 } as never }, 'core.type.board'),
    );

    expect(controller.getConfig().plugins).toEqual({ board: { enabled: true, maxEmbedDepth: 5 } });
  });

  it('carries whatever `entities.defaultType` the config resolved, verbatim', async () => {
    const controller = await controllerFor(configWith({}, 'world.type.deity'));

    expect(controller.getConfig().entities.defaultType).toBe('world.type.deity');
  });

  it('carries the Deployment Profile and Collaboration flag (ADR-0071)', async () => {
    const desktop = await controllerFor(configWith({}, 'core.type.note', { profile: 'desktop', collaboration: false }));

    expect(desktop.getConfig().profile).toBe('desktop');
    expect(desktop.getConfig().collaboration).toBe(false);
  });

  it('crosses the two flags independently — a server Instance may have Collaboration off', async () => {
    // The solo self-hoster: a real login page, no sharing UI (ADR-0071).
    const solo = await controllerFor(configWith({}, 'core.type.note', { profile: 'server', collaboration: false }));

    expect(solo.getConfig().profile).toBe('server');
    expect(solo.getConfig().collaboration).toBe(false);
  });
});
