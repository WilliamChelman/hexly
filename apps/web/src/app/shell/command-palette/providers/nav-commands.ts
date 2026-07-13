import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AuthClient } from '@hexly/web-core';
import { Command, CommandProvider } from '../command';

/**
 * The `>`-prefix navigation Commands (ADR-0041): the instance-scoped destinations the
 * contextual nav rail hides while inside a World — Users (gated on
 * {@link AuthClient.canManageUsers}), the Admin repair surface (gated on
 * {@link AuthClient.isSuperadmin}), and the Styleguide. Each carries a `route`, so the
 * Palette renders the row as an anchor that opens in a new tab too.
 */
@Injectable({ providedIn: 'root' })
export class NavCommands implements CommandProvider {
  private readonly auth = inject(AuthClient);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  readonly prefix = '>';
  readonly label = 'commandPalette.commands';

  search(query: string): Observable<readonly Command[]> {
    const q = query.trim().toLowerCase();
    const commands: Command[] = [
      ...(this.auth.canManageUsers() ? [this.nav('go-users', 'commandPalette.goToUsers', ['/users'])] : []),
      ...(this.auth.isSuperadmin() ? [this.nav('go-admin', 'commandPalette.goToAdmin', ['/admin'])] : []),
      this.nav('go-styleguide', 'commandPalette.goToStyleguide', ['/styleguide']),
    ];
    return of(commands.filter((c) => c.label.toLowerCase().includes(q)));
  }

  private nav(id: string, labelKey: string, route: string[]): Command {
    return {
      id,
      label: this.transloco.translate(labelKey),
      route,
      run: () => void this.router.navigate(route),
    };
  }
}
