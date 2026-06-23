import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { LocaleService } from './core/i18n/locale.service';
import { AppHeader } from './shell/app-header';
import { Toaster } from './shell/toaster';

/**
 * Application root and shell. It owns the single, always-present
 * {@link AppHeader} (ADR-0015) above the routed outlet, and eagerly constructs
 * {@link ThemeService} and {@link LocaleService} so the active theme and
 * language are applied on boot.
 */
@Component({
  selector: 'app-root',
  host: { class: 'flex flex-col h-screen' },
  imports: [RouterOutlet, AppHeader, Toaster],
  template: `
    <!--
      The outlet is the scroll container, so the always-present header stays
      fixed above it while long pages (the library, the styleguide) scroll.
      The editor fills the outlet exactly and manages its own overflow.
    -->
    <app-header />
    <main class="flex-1 min-h-0 overflow-auto">
      <router-outlet />
    </main>
    <app-toaster />
  `,
})
export class App {
  // Eagerly resolve the theme service so `data-theme` is wired up at startup.
  protected readonly theme = inject(ThemeService);
  // Eagerly resolve the locale service so the detected/remembered language is
  // active before the first page renders.
  protected readonly locale = inject(LocaleService);
}
