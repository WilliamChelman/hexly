import { Injectable, signal } from '@angular/core';
import { CommandProvider } from './command';

/**
 * Where Command Providers make themselves known to the Command Palette
 * (CONTEXT.md → Command Registry, ADR-0032). One root-level list: built-in
 * Providers register once at bootstrap and live for the app's lifetime; a
 * contextual Provider registers from its owning component and calls the returned
 * unregister fn on destroy. The Registry doesn't distinguish the two — both are
 * just Providers with different registration lifetimes.
 */
@Injectable({ providedIn: 'root' })
export class CommandRegistry {
  private readonly providers = signal<readonly CommandProvider[]>([]);

  /** Register a Provider; the returned fn unregisters it (for contextual lifetimes). */
  register(provider: CommandProvider): () => void {
    this.providers.update((ps) => [...ps, provider]);
    return () => this.providers.update((ps) => ps.filter((p) => p !== provider));
  }

  /** The Providers answering `prefix`, in registration order (stable sections). */
  providersFor(prefix: string): readonly CommandProvider[] {
    return this.providers().filter((p) => p.prefix === prefix);
  }
}
