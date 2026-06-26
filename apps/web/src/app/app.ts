import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ThemeService } from './core/theme.service';
import { LocaleService } from './core/i18n/locale.service';
import { NavRail } from './shell/nav-rail';
import { Toaster } from './shell/toaster';

/**
 * Application root and shell. The only persistent chrome is the {@link NavRail}
 * (ADR-0022, supersedes ADR-0015): it docks beside a bare routed outlet, and
 * each page renders its own header. The rail is hidden on `/login` so the
 * authentication screen stands alone. {@link ThemeService} and
 * {@link LocaleService} are eagerly constructed so the active theme and language
 * are applied on boot.
 */
@Component({
  selector: 'app-root',
  host: { class: 'flex h-screen' },
  imports: [RouterOutlet, NavRail, Toaster],
  template: `
    @if (!standalone()) {
      <app-nav-rail />
    }
    <!--
      The outlet region is the scroll container, so the docked rail stays put
      while long pages scroll; the editor fills it exactly and manages its own
      overflow.
    -->
    <main class="flex-1 min-w-0 overflow-auto">
      <router-outlet />
    </main>
    <app-toaster />
  `,
})
export class App {
  private readonly router = inject(Router);

  // Eagerly resolve the theme service so `data-theme` is wired up at startup.
  protected readonly theme = inject(ThemeService);
  // Eagerly resolve the locale service so the detected/remembered language is
  // active before the first page renders.
  protected readonly locale = inject(LocaleService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Login renders without the rail — no app chrome the user can't use yet. */
  protected readonly standalone = computed(() => this.url().startsWith('/login'));
}
