import { HttpClient } from '@angular/common/http';
import {
  EnvironmentProviders,
  inject,
  Injectable,
  InjectionToken,
  makeEnvironmentProviders,
  provideAppInitializer,
  signal,
  Signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ClientConfig } from '@hexly/domain';

/**
 * The browser's end of the client config channel (ADR-0052, Seam 4): the enabled-Plugin set and default
 * create Type, hydrated once at boot from `GET /api/config`. Signals, not a resource, so a future live
 * path (ADR-0044) can push a fresh set in without touching the readers.
 */
@Injectable({ providedIn: 'root' })
export class ClientConfigStore {
  private readonly http = inject(HttpClient);

  private readonly enabledSignal = signal<ReadonlySet<string>>(new Set());
  private readonly defaultTypeSignal = signal<string | undefined>(undefined);

  /** The enabled bundled Plugins' ids; empty until {@link init} resolves. */
  readonly enabledPlugins: Signal<ReadonlySet<string>> = this.enabledSignal.asReadonly();

  /** The Type id the "New" button mints by default; `undefined` until {@link init} resolves. */
  readonly defaultType: Signal<string | undefined> = this.defaultTypeSignal.asReadonly();

  isPluginEnabled(id: string): boolean {
    return this.enabledSignal().has(id);
  }

  /** Fetch `/api/config` and populate the signals; a failed fetch leaves the boot defaults. */
  async init(): Promise<void> {
    try {
      const config = await firstValueFrom(this.http.get<ClientConfig>('/api/config'));
      const enabledIds = Object.entries(config.plugins)
        .filter(([, plugin]) => plugin.enabled)
        .map(([id]) => id);
      this.enabledSignal.set(new Set(enabledIds));
      this.defaultTypeSignal.set(config.entities.defaultType);
    } catch {
      /* no channel means no enablement info; the signals keep their boot defaults */
    }
  }
}

/**
 * The enabled-Plugin set as a bare reactive signal (ADR-0052, Seam 3) — what the Type/View registries
 * filter against. A signal, not the whole {@link ClientConfigStore}, so the registries need not drag its
 * `HttpClient` into every test. Provided by {@link provideClientConfig}; absent means "no config channel
 * wired", at which the registries filter nothing (today's behaviour). What an empty present set means —
 * all-Plugins-off, or a failed/not-yet-run fetch — is the store's concern (see {@link ClientConfigStore.init}).
 */
export const ENABLED_PLUGINS = new InjectionToken<Signal<ReadonlySet<string>>>('hexly.config.enabledPlugins');

/** Fetch the client config before bootstrap, so registries read a settled enabled set (ADR-0052). */
export function provideClientConfig(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => inject(ClientConfigStore).init()),
    { provide: ENABLED_PLUGINS, useFactory: () => inject(ClientConfigStore).enabledPlugins },
  ]);
}
