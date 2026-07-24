import { Signal, signal } from '@angular/core';
import { DeploymentProfile } from '@hexly/domain';
import { ClientConfigStore } from '../services/client-config.store';

/** What a spec drives on the fake store; anything omitted keeps the real store's fall-open answer. */
export interface ClientConfigOverrides {
  readonly enabledPlugins?: Signal<ReadonlySet<string>>;
  readonly defaultType?: Signal<string | undefined>;
  readonly collaboration?: Signal<boolean>;
  readonly profile?: Signal<DeploymentProfile>;
}

/**
 * A settled {@link ClientConfigStore} whose flags a spec drives through signals, so a gate can be
 * re-read after a flip. Every unstated flag reads the fall-open answer the real store gives before
 * `/api/config` resolves (ADR-0052, ADR-0071): all Plugins enabled, Collaboration on, `server`.
 *
 * A cast object rather than a subclass: the store resolves `HttpClient` lazily in `init`, which this
 * stubs out, so a consumer's spec needs no HTTP wiring for a fetch it never triggers.
 */
export function mockClientConfigStore(overrides: ClientConfigOverrides = {}): ClientConfigStore {
  const enabled = overrides.enabledPlugins ?? signal<ReadonlySet<string>>(new Set());
  const collaboration = overrides.collaboration ?? signal(true);
  const profile = overrides.profile ?? signal<DeploymentProfile>('server');
  return {
    enabledPlugins: enabled,
    defaultType: overrides.defaultType ?? signal(undefined),
    pluginConfig: () => undefined,
    // Unstated `enabledPlugins` means "everything on", as the unresolved real store reads.
    isPluginEnabled: (id: string) => !overrides.enabledPlugins || enabled().has(id),
    isCollaborationEnabled: () => collaboration(),
    isDesktopProfile: () => profile() === 'desktop',
    init: async () => undefined,
  } as unknown as ClientConfigStore;
}
