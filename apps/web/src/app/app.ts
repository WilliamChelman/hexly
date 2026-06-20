import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';

/**
 * Application root. It owns no chrome of its own — the editor shell and the
 * styleguide are routed views — but it eagerly constructs {@link ThemeService}
 * so the active theme is applied on boot.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
  `,
})
export class App {
  // Eagerly resolve the theme service so `data-theme` is wired up at startup.
  protected readonly theme = inject(ThemeService);
}
