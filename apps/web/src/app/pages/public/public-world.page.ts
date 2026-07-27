import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, catchError, of, switchMap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { PublicWorldView } from '@hexly/domain';
import { PublicClient, AppShellStore, EVICTED, WorldThemeApplier } from '@hexly/web-core';
import { EyebrowComponent } from '@hexly/web-ui';

/**
 * A World Public Link landing page: lists the World's `shared` Entities — and nothing else — as
 * links a reader with no account opens read-only through {@link PublicEntityPage} at
 * `/public/w/:token/e/:entityId`. A revoked or bad token resolves to a dead-link panel, never an
 * error.
 */
@Component({
  selector: 'app-public-world-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, RouterLink, EyebrowComponent],
  template: `
    <main class="public-world">
      <p class="public-banner" data-testid="public-banner">
        {{ 'publicView.banner' | transloco }}
      </p>
      @if (view(); as w) {
        <h1 class="public-title" data-testid="public-world-name">
          {{ w.worldName }}
        </h1>
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
          <p class="public-muted">
            {{ 'publicView.notFoundBody' | transloco }}
          </p>
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
      @apply text-accent-strong underline;
    }
  `,
})
export class PublicWorldPage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(PublicClient);
  private readonly shell = inject(AppShellStore);
  private readonly theme = inject(WorldThemeApplier);

  readonly view = signal<PublicWorldView | null>(null);
  readonly notFound = signal(false);
  readonly token = signal('');
  /** The World this anonymous reader live-follows; null while none is open. */
  private readonly followed = signal<{ token: string; id: string } | null>(null);

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
          this.followed.set(null);
          return this.client.world(token).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((w) => {
        if (w) {
          this.view.set(w);
          this.followed.set({ token: this.token(), id: w.worldId });
        } else {
          this.notFound.set(true);
        }
        this.applyTheme(w);
      });

    // EVICTED (link revoked, World deleted, a 403/404 refetch) → the dead-link panel, without a
    // reload. switchMap off `followed` tears down the old follow (reverting the token principal) on
    // a token swap.
    toObservable(this.followed)
      .pipe(
        switchMap((f) => (f === null ? EMPTY : this.client.watchWorld(f.token, f.id))),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (result === EVICTED) return this.evict();
        this.view.set(result);
        this.applyTheme(result);
      });
  }

  /**
   * Paint this World's Theme for a reader with no account (ADR-0076): it rides the unauthenticated
   * read, keyed by the token because that is the only World identity such a visitor ever holds. Called
   * off the live-follow too, so an Owner's edit reaches them without a refresh.
   */
  private applyTheme(view: PublicWorldView | null): void {
    this.theme.scope({ publicToken: this.token() }, view?.theme ?? null);
  }

  /** Blank the World and show the dead-link panel — access ended on the open screen. */
  private evict(): void {
    this.followed.set(null);
    this.view.set(null);
    this.notFound.set(true);
  }
}
