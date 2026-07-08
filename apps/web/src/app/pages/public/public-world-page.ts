import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, catchError, debounceTime, filter, of, switchMap, tap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { PublicWorldView } from '@hexly/domain';
import {
  PublicClient,
  NudgeBusClient,
  AppShellStore,
  WORLD_NUDGE_DEBOUNCE_MS,
} from '@hexly/web-core';
import { Eyebrow } from '@hexly/web-ui';

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
  private readonly bus = inject(NudgeBusClient);

  readonly view = signal<PublicWorldView | null>(null);
  readonly notFound = signal(false);
  readonly token = signal('');
  /** The World this anonymous reader live-follows; null while none is open. */
  private readonly followed = signal<{ token: string; id: string } | null>(null);

  constructor() {
    this.shell.standalone.set(true);
    inject(DestroyRef).onDestroy(() => {
      this.shell.standalone.set(false);
      // Unpin the token from the root-singleton bus, or a signed-in user who opened their own
      // World link would keep connecting as that token afterwards (mirrors PublicEntityPage).
      this.bus.useToken(null);
    });

    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const token = params.get('token') ?? '';
          this.token.set(token);
          this.view.set(null);
          this.notFound.set(false);
          this.followed.set(null);
          // Connect the bus as this token principal; the stream reopens when it changes.
          this.bus.useToken(token);
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
      });

    // Live-follow the open World (ADR-0044, #178): a readable world nudge (rename / pin / metadata)
    // → debounced refetch-and-replace; `unavailable` (link revoked, World deleted) → the dead-link
    // panel without a reload. switchMap off `followed` tears down the old follow on a token swap. A
    // public reader never curates, so there's no self-echo to dedupe.
    toObservable(this.followed)
      .pipe(
        switchMap((f) =>
          f === null
            ? EMPTY
            : this.bus.follow({ kind: 'world', id: f.id }).pipe(
                tap((n) => {
                  if ('unavailable' in n) this.evict();
                }),
                filter((n) => !('unavailable' in n)),
                debounceTime(WORLD_NUDGE_DEBOUNCE_MS),
                switchMap(() =>
                  this.client.world(f.token).pipe(
                    // A refetch 404 means the World/link just went away — evict.
                    catchError(() => {
                      this.evict();
                      return EMPTY;
                    }),
                  ),
                ),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((w) => this.view.set(w));
  }

  /** Blank the World and show the dead-link panel — access ended on the open screen. */
  private evict(): void {
    this.followed.set(null);
    this.view.set(null);
    this.notFound.set(true);
  }
}
