import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { AppHeader } from './shell/app-header';

/**
 * Application root and shell. It owns the single, always-present
 * {@link AppHeader} (ADR-0015) above the routed outlet, and eagerly constructs
 * {@link ThemeService} so the active theme is applied on boot.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader],
  template: `
    <app-header />
    <main class="outlet">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .outlet {
      flex: 1;
      min-height: 0;
    }
  `,
})
export class App {
  // Eagerly resolve the theme service so `data-theme` is wired up at startup.
  protected readonly theme = inject(ThemeService);
}
