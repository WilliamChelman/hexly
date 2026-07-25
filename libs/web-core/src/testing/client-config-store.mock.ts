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
 * A settled {@link ClientConfigStore} whose flags a spec drives through signals. Unstated flags read the
 * fall-open answers of the real store before `/api/config` resolves (ADR-0052, ADR-0071).
 *
 * A cast object rather than a subclass, so a consumer's spec needs no HTTP wiring for a fetch it never makes.
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
