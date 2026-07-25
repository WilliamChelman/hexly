import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AuthClient, ClientConfigStore } from '@hexly/web-core';
import { Command, CommandDirectory, CommandProvider } from '@hexly/command-palette-web';

/** The Worlds index, named by the Desktop App's native menu as well as the Palette (ADR-0070). */
export const GO_TO_WORLDS = 'go-worlds';

/**
 * The `>`-prefix navigation Commands (ADR-0041): the instance-scoped destinations the
 * contextual nav rail hides while inside a World — the Worlds index, Users (on the
 * Collaboration cut list, ADR-0071, then gated on {@link AuthClient.canManageUsers}), the
 * Admin repair surface (gated on {@link AuthClient.isSuperadmin}, and on neither cut list),
 * and the Styleguide. Each carries a `route`, so the Palette renders the row as an anchor
 * that opens in a new tab too.
 */
@Injectable({ providedIn: 'root' })
export class NavCommands implements CommandProvider {
  private readonly auth = inject(AuthClient);
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly directory = inject(CommandDirectory);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  /** Built once and held: the Palette lists it and the native menu invokes it by id — one `run`, not a copy
   * per surface (ADR-0070). */
  private readonly goToWorlds = this.nav(GO_TO_WORLDS, 'commandPalette.goToWorlds', ['/worlds']);

  constructor() {
    // Root-provided and app-lifetime, so nothing unregisters.
    this.directory.register(this.goToWorlds);
  }

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    const commands: Command[] = [
      this.goToWorlds,
      ...(this.clientConfig.isCollaborationEnabled() && this.auth.canManageUsers()
        ? [this.nav('go-users', 'commandPalette.goToUsers', ['/users'])]
        : []),
      ...(this.auth.isSuperadmin() ? [this.nav('go-admin', 'commandPalette.goToAdmin', ['/admin'])] : []),
      this.nav('go-styleguide', 'commandPalette.goToStyleguide', ['/styleguide']),
    ];
    return of(commands.filter((c) => c.label.toLowerCase().includes(q)));
  }

  private nav(id: string, labelKey: string, route: string[]): Command {
    const transloco = this.transloco;
    return {
      id,
      // Resolved on read: a held Command would otherwise keep the language it was built in, and `search`
      // filters on this text.
      get label() {
        return transloco.translate(labelKey);
      },
      route,
      run: () => void this.router.navigate(route),
    };
  }
}
