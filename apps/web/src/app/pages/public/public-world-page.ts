import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { PublicWorldView } from '@hexly/domain';
import { PublicClient } from '../../core/services/public.client';
import { AppShellStore } from '../../shell/app-shell.store';
import { Eyebrow } from '../../ui/eyebrow';

/**
 * A World Public Link landing page (ADR-0037, #162): lists the World's `shared` Entities —
 * and nothing else — as links a reader with no account opens read-only through
 * {@link PublicEntityPage} at `/public/w/:token/e/:entityId`. Standalone chrome, like login.
 * A revoked or bad token resolves to a calm dead-link panel, never an error.
 */
@Component({
  selector: 'app-public-world-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, RouterLink, Eyebrow],
  template: `
    <main class="public-world">
      <p class="public-banner" data-testid="public-banner">
        {{ 'publicView.banner' | transloco }}
      </p>
      @if (view(); as w) {
        <h1 class="public-title" data-testid="public-world-name">{{ w.worldName }}</h1>
        <span appEyebrow>{{ 'publicView.worldEntities' | transloco }}</span>
        <ul class="public-list">
          @for (e of w.entities; track e.id) {
            <li>
              <a
                class="public-link"
                [attr.data-testid]="'public-page-' + e.id"
                [routerLink]="['/public/w', token(), 'e', e.id]"
                >{{ e.name }}</a
              >
            </li>
          }
        </ul>
      } @else if (notFound()) {
        <div data-testid="public-notfound">
          <h1 class="public-title">{{ 'publicView.notFound' | transloco }}</h1>
          <p class="public-muted">{{ 'publicView.notFoundBody' | transloco }}</p>
        </div>
      }
    </main>
  `,
  styles: `
    @reference '#app-styles.css';
    .public-world {
      @apply mx-auto flex w-full max-w-2xl flex-col gap-3 p-6;
    }
    .public-banner {
      @apply rounded bg-surface px-3 py-2 text-sm text-ink-muted;
    }
    .public-title {
      @apply font-display text-2xl text-ink-strong;
    }
    .public-muted {
      @apply text-sm text-ink-muted;
    }
    .public-list {
      @apply flex flex-col gap-1;
    }
    .public-link {
      @apply text-gold-strong underline;
    }
  `,
})
export class PublicWorldPage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(PublicClient);
  private readonly shell = inject(AppShellStore);

  readonly view = signal<PublicWorldView | null>(null);
  readonly notFound = signal(false);
  readonly token = signal('');

  constructor() {
    this.shell.standalone.set(true);
    inject(DestroyRef).onDestroy(() => this.shell.standalone.set(false));

    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const token = params.get('token') ?? '';
          this.token.set(token);
          this.view.set(null);
          this.notFound.set(false);
          return this.client.world(token).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((w) => (w ? this.view.set(w) : this.notFound.set(true)));
  }
}
