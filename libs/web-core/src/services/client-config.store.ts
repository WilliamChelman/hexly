import { HttpClient } from '@angular/common/http';
import {
  EnvironmentProviders,
  Injector,
  inject,
  Injectable,
  provideAppInitializer,
  signal,
  Signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ClientConfig, ClientPluginConfig } from '@hexly/domain';

/**
 * The browser's end of the client config channel (ADR-0052, Seam 4): the enabled-Plugin set and default
 * create Type, hydrated once at boot from `GET /api/config`. Signals, not a resource, so a future live
 * path (ADR-0044) can push a fresh set in without touching the readers.
 *
 * Owns the enablement predicate the Type/View registries filter through — {@link isPluginEnabled} —
 * rather than exposing the raw set for them to interpret. Until {@link init} resolves (or if it fails),
 * every Plugin reads as enabled: the boot fetch is an `APP_INITIALIZER`, so nothing sees the unresolved
 * state in the app, and a failed fetch falls open to today's behaviour rather than blanking every Plugin.
 */
@Injectable({ providedIn: 'root' })
export class ClientConfigStore {
  // Resolved lazily in init(), not at construction, so a component/registry that injects this store in a
  // unit test need not wire up HttpClient for a fetch the test never triggers.
  private readonly injector = inject(Injector);

  private readonly enabledSignal = signal<ReadonlySet<string>>(new Set());
  private readonly configsSignal = signal<Readonly<Record<string, ClientPluginConfig>>>({});
  private readonly defaultTypeSignal = signal<string | undefined>(undefined);
  private readonly loadedSignal = signal(false);

  /** The enabled bundled Plugins' ids; empty until {@link init} resolves. */
  readonly enabledPlugins: Signal<ReadonlySet<string>> = this.enabledSignal.asReadonly();

  /** A bundled Plugin's client-visible config (its `enabled` state and any whitelisted knobs), or `undefined` until {@link init} resolves. */
  pluginConfig(id: string): ClientPluginConfig | undefined {
    return this.configsSignal()[id];
  }

  /** The Type id the "New" button mints by default; `undefined` until {@link init} resolves. */
  readonly defaultType: Signal<string | undefined> = this.defaultTypeSignal.asReadonly();

  /** Whether `id`'s Plugin is enabled; reactive. Everything reads enabled until config loads (ADR-0052). */
  isPluginEnabled(id: string): boolean {
    return !this.loadedSignal() || this.enabledSignal().has(id);
  }

  /** Fetch `/api/config` and populate the signals; a failed fetch leaves the boot defaults (all enabled). */
  async init(): Promise<void> {
    try {
      const http = this.injector.get(HttpClient);
      const config = await firstValueFrom(http.get<ClientConfig>('/api/config'));
      const enabledIds = Object.entries(config.plugins)
        .filter(([, plugin]) => plugin.enabled)
        .map(([id]) => id);
      this.enabledSignal.set(new Set(enabledIds));
      this.configsSignal.set(config.plugins);
      this.defaultTypeSignal.set(config.entities.defaultType);
      this.loadedSignal.set(true);
    } catch {
      /* no channel means no enablement info; the signals keep their boot defaults, filtering stays off */
    }
  }
}

/** Fetch the client config before bootstrap, so registries read a settled enabled set (ADR-0052). */
export function provideClientConfig(): EnvironmentProviders {
  return provideAppInitializer(() => inject(ClientConfigStore).init());
}
