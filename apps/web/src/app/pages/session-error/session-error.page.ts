import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppShellStore } from '@hexly/web-core';
import { EyebrowComponent } from '@hexly/web-ui';

/**
 * Where a session that cannot be recovered lands in the desktop profile, which has no login page to send
 * it to (ADR-0070, ADR-0071). CTA-free: re-minting is the preload bridge's job. Standalone, like the login
 * page — every rail destination bounces without a session.
 */
@Component({
  selector: 'app-session-error-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EyebrowComponent, TranslocoPipe],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <main
      class="mx-auto flex max-w-[40rem] flex-col items-center gap-3 px-6 py-[6rem] text-center"
      data-testid="session-error"
    >
      <span appEyebrow class="text-accent! tracking-[0.28em]">{{ 'auth.sessionError.eyebrow' | transloco }}</span>
      <h1 class="m-0 font-display text-[28px] leading-tight text-ink-strong">
        {{ 'auth.sessionError.heading' | transloco }}
      </h1>
      <p class="text-ink-muted">{{ 'auth.sessionError.hint' | transloco }}</p>
    </main>
  `,
})
export class SessionErrorPage {
  constructor() {
    const shell = inject(AppShellStore);
    shell.standalone.set(true);
    inject(DestroyRef).onDestroy(() => shell.standalone.set(false));
  }
}
