import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, EyebrowComponent } from '@hexly/web-ui';

/**
 * The catch-all error page: shown for an unmatched URL and when `/entities/:id`
 * can't resolve its target's World (missing/inaccessible Entity).
 */
@Component({
  selector: 'app-error-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, EyebrowComponent, RouterLink, TranslocoPipe],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <main class="mx-auto flex max-w-[40rem] flex-col items-center gap-3 px-6 py-[6rem] text-center">
      <span appEyebrow class="text-accent! tracking-[0.28em]">{{ 'error.eyebrow' | transloco }}</span>
      <h1 class="m-0 font-display text-[28px] leading-tight text-ink-strong">
        {{ 'error.heading' | transloco }}
      </h1>
      <p class="text-ink-muted">{{ 'error.hint' | transloco }}</p>
      <a appButton variant="primary" routerLink="/" data-testid="error-home">
        {{ 'error.backToWorlds' | transloco }}
      </a>
    </main>
  `,
})
export class ErrorPage {}
