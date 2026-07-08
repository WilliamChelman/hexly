import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  EMPTY,
  catchError,
  combineLatest,
  debounceTime,
  filter,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityNudge } from '@hexly/domain';
import { PublicClient, NudgeBusClient, AppShellStore } from '@hexly/web-core';
import { EntitySession } from '../entity/services/entity-session';
import { EntityNameResolver, CONTENT_EDITOR_SESSION } from '@hexly/content-editor';
import { PublicEntityNameResolver } from './public-entity-name-resolver';
import { OutlineStore } from '../entity/services/outline-store';
import { EntityPage } from '../entity/entity.page';

// Coalesces a save burst into one refetch.
const NUDGE_DEBOUNCE_MS = 150;

interface Followed {
  token: string;
  mode: 'entity' | 'worldEntity';
  id: string;
}

/**
 * A Public Link Entity page: reuses {@link EntityPage}, driven read-only by the
 * server shipping `rights: ['read']`. Fetches via {@link PublicClient} and adopts
 * into the session, marked externally driven so EntityPage's `watchRoute` never
 * fires an authenticated load. {@link PublicEntityNameResolver} resolves no
 * in-content Entity Links — a Public Link grants only its own scope, so
 * cross-references render as their frozen label.
 */
@Component({
  selector: 'app-public-entity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col' },
  providers: [
    EntitySession,
    { provide: CONTENT_EDITOR_SESSION, useExisting: EntitySession },
    { provide: EntityNameResolver, useClass: PublicEntityNameResolver },
    OutlineStore,
  ],
  imports: [TranslocoPipe, RouterLink, EntityPage],
  template: `
    <p class="public-banner" data-testid="public-banner">
      @if (backToken(); as bt) {
        <a class="public-back" data-testid="public-back" [routerLink]="['/public/w', bt]">←</a>
      }
      {{ 'publicView.banner' | transloco }}
    </p>
    @if (notFound()) {
      <div class="public-notfound" data-testid="public-notfound">
        <h1 class="public-title">{{ 'publicView.notFound' | transloco }}</h1>
        <p class="public-muted">{{ 'publicView.notFoundBody' | transloco }}</p>
      </div>
    } @else {
      <div class="min-h-0 flex-1">
        <app-entity-page />
      </div>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .public-banner {
      @apply flex items-center gap-2 bg-surface px-4 py-2 text-sm text-ink-muted;
    }
    .public-back {
      @apply text-gold-strong;
    }
    .public-notfound {
      @apply mx-auto flex w-full max-w-2xl flex-col gap-2 p-6;
    }
    .public-title {
      @apply font-display text-2xl text-ink-strong;
    }
    .public-muted {
      @apply text-sm text-ink-muted;
    }
  `,
})
export class PublicEntityPage {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(PublicClient);
  private readonly session = inject(EntitySession);
  private readonly shell = inject(AppShellStore);
  private readonly bus = inject(NudgeBusClient);

  /** True once a token failed to resolve (revoked/bad) — shows the dead-link panel. */
  readonly notFound = signal(false);
  /** World token for the back link on a world-scoped page; null for a bare link. */
  readonly backToken = signal<string | null>(null);
  /** The resource this anonymous reader live-follows; null while none is open. */
  private readonly followed = signal<Followed | null>(null);

  constructor() {
    // Must happen before the reused EntityPage mounts, so its watchRoute never
    // fires an authenticated load over the adopted Entity.
    this.session.markExternallyDriven();

    this.shell.standalone.set(true);
    inject(DestroyRef).onDestroy(() => {
      this.shell.standalone.set(false);
      // Unpin the token from the root-singleton bus: otherwise a signed-in user
      // who opened their own public link would keep connecting as that token,
      // and every other Entity would resolve to `unavailable` until a reload.
      this.bus.useToken(null);
    });

    combineLatest([this.route.paramMap, this.route.data])
      .pipe(
        switchMap(([params, data]) => {
          this.notFound.set(false);
          const token = params.get('token') ?? '';
          const worldScoped = data['mode'] === 'worldEntity';
          const mode: Followed['mode'] = worldScoped ? 'worldEntity' : 'entity';
          this.backToken.set(worldScoped ? token : null);
          // Connect the bus as this token principal; the stream reopens when it changes.
          this.bus.useToken(token);
          const read$ = worldScoped
            ? this.client.worldEntity(token, params.get('entityId') ?? '')
            : this.client.entity(token);
          return read$.pipe(
            tap((entity) =>
              this.followed.set({ token, mode, id: entity.id }),
            ),
            catchError(() => of(null)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((entity) => {
        if (entity) this.session.adopt(entity);
        else {
          this.followed.set(null);
          this.notFound.set(true);
        }
      });

    // Live-follow the open Entity: a nudge newer than held → silent refetch-and-
    // replace; `unavailable` (link revoked) → the dead-link panel without a
    // reload. switchMap off `followed` tears down the old follow when the Entity
    // swaps. A public reader never edits, so no dirty guard.
    toObservable(this.followed)
      .pipe(
        switchMap((f) =>
          f === null
            ? EMPTY
            : this.bus.follow({ kind: 'entity', id: f.id }).pipe(
                tap((n) => {
                  if ('unavailable' in n) {
                    this.followed.set(null);
                    this.notFound.set(true);
                  }
                }),
                filter((n): n is EntityNudge => !('unavailable' in n)),
                filter((n) => this.newerThanHeld(n)),
                debounceTime(NUDGE_DEBOUNCE_MS),
                filter((n) => this.newerThanHeld(n)),
                switchMap(() =>
                  (f.mode === 'worldEntity'
                    ? this.client.worldEntity(f.token, f.id)
                    : this.client.entity(f.token)
                  ).pipe(
                    // A refetch 404 means the resource just went away (revoked/deleted) — evict.
                    catchError(() => {
                      this.followed.set(null);
                      this.notFound.set(true);
                      return EMPTY;
                    }),
                  ),
                ),
              ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((entity) => this.session.adopt(entity));
  }

  /** Version, then updatedAt tiebreak. */
  private newerThanHeld(n: EntityNudge): boolean {
    const held = this.session.current();
    if (!held) return false;
    return (
      n.version > held.version ||
      (n.version === held.version && n.updatedAt > held.updatedAt)
    );
  }
}
