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
import { ClientConfig, ClientPluginConfig, DeploymentProfile } from '@hexly/domain';

/**
 * The browser's end of the client config channel (ADR-0052, Seam 4): the enabled-Plugin set, the default
 * create Type, and ADR-0071's Deployment Profile and Collaboration flag, hydrated once at boot from
 * `GET /api/config`. Signals, not a resource, so a future live path (ADR-0044) can push a fresh set in
 * without touching the readers.
 *
 * Owns a predicate per flag — {@link isPluginEnabled}, {@link isCollaborationEnabled},
 * {@link isDesktopProfile} — rather than exposing raw values for callers to interpret. Until {@link init}
 * resolves (or if it fails), every gate **falls open**: every Plugin reads enabled, Collaboration reads
 * on, and the profile reads `server`. The boot fetch is an `APP_INITIALIZER`, so nothing in the app sees
 * the unresolved state, and a failed fetch degrades to today's behaviour rather than blanking the UI.
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
  // Seeded with the fall-open answers, so an unresolved fetch and a failed one need no separate handling.
  private readonly collaborationSignal = signal(true);
  private readonly profileSignal = signal<DeploymentProfile>('server');

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

  /**
   * Whether the Collaboration layer is on (ADR-0071) — the gate for sharing, World roles, Entity
   * Visibility and Public Links; reactive. Reads **on** until config loads, and if the fetch fails.
   */
  isCollaborationEnabled(): boolean {
    return this.collaborationSignal();
  }

  /**
   * Whether this Instance runs the `desktop` Deployment Profile (ADR-0071) — a *policy* question, so it
   * reads the flag; "can I re-mint a session?" is a capability question and checks the bridge instead.
   * Reads **server** until config loads, and if the fetch fails.
   */
  isDesktopProfile(): boolean {
    return this.profileSignal() === 'desktop';
  }

  /** Fetch `/api/config` and populate the signals; a failed fetch leaves the boot defaults (all gates open). */
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
      // Defaulted again, not just typed: a payload that omits a flag must not close a gate ADR-0071
      // says falls open.
      this.collaborationSignal.set(config.collaboration ?? true);
      this.profileSignal.set(config.profile ?? 'server');
      this.loadedSignal.set(true);
    } catch {
      /* no channel means no config; the signals keep their boot defaults, so every gate falls open */
    }
  }
}

/** Fetch the client config before bootstrap, so registries read a settled enabled set (ADR-0052). */
export function provideClientConfig(): EnvironmentProviders {
  return provideAppInitializer(() => inject(ClientConfigStore).init());
}
