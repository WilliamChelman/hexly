import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ThemeService } from './core/theme.service';
import { LocaleService } from './core/i18n/locale.service';
import { AppShellStore } from './shell/app-shell.store';
import { NavRail } from './shell/nav-rail';
import { Toaster } from './shell/toaster';

/** Application root. The only persistent chrome is the {@link NavRail} (ADR-0022). */
@Component({
  selector: 'app-root',
  host: { class: 'flex h-screen' },
  imports: [RouterOutlet, NavRail, Toaster],
  template: `
    @if (navigated() && !shell.standalone()) {
      <app-nav-rail />
    }
    <!--
      Outlet is the scroll container so the docked rail stays put while pages
      scroll. Not a landmark: each page owns its own <main>.
    -->
    <div class="flex-1 min-w-0 overflow-auto">
      <router-outlet />
    </div>
    <app-toaster />
  `,
})
export class App {
  protected readonly shell = inject(AppShellStore);
  protected readonly theme = inject(ThemeService);
  protected readonly locale = inject(LocaleService);

  // Hold the rail back until the first navigation resolves; by then the landing
  // page's constructor has set `standalone`, so a cold load on /login never
  // flashes the rail.
  protected readonly navigated = toSignal(
    inject(Router).events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => true),
    ),
    { initialValue: false },
  );
}
