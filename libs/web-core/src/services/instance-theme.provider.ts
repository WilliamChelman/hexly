import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { ClientConfigStore } from './client-config.store';
import { INSTANCE_THEME, INSTANCE_THEME_READY } from './world-theme.applier';

/**
 * Source the World Theme chain's first layer from Instance Configuration (ADR-0076, #372). Its own
 * file so neither end learns about the other: the applier still asks only for a layer, and the config
 * store still only serves `/api/config`.
 *
 * Both tokens read the same memoised fetch — the layer, and the promise `provideWorldTheme()` holds
 * the applier back on until that layer exists.
 */
export function provideInstanceTheme(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: INSTANCE_THEME_READY, useFactory: () => inject(ClientConfigStore).init() },
    { provide: INSTANCE_THEME, useFactory: () => inject(ClientConfigStore).instanceTheme() },
  ]);
}
