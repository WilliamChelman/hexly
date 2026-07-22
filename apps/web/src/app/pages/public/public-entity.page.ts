import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, catchError, combineLatest, of, switchMap, tap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityNudge, StaleNudge } from '@hexly/domain';
import { PublicClient, PublicEntityMode, AppShellStore, EVICTED } from '@hexly/web-core';
import { ENTITY_SESSION, UNIVERSAL_PANELS } from '@hexly/web-entity';
import { EntitySession } from '../entity/services/entity-session';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { PublicEntityNameResolver } from './services/public-entity-name-resolver';
import { EntityPage } from '../entity/entity.page';

interface Followed {
  token: string;
  mode: PublicEntityMode;
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
    { provide: ENTITY_SESSION, useExisting: EntitySession },
    { provide: EntityNameResolver, useClass: PublicEntityNameResolver },
    // The page Dock offers no universal Panel here: References needs `/entities/:id/references`, which
    // answers an authenticated user, and this Entity's Public Link grants no scope beyond itself.
    { provide: UNIVERSAL_PANELS, useValue: [] },
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
    inject(DestroyRef).onDestroy(() => this.shell.standalone.set(false));

    combineLatest([this.route.paramMap, this.route.data])
      .pipe(
        switchMap(([params, data]) => {
          this.notFound.set(false);
          const token = params.get('token') ?? '';
          const worldScoped = data['mode'] === 'worldEntity';
          const mode: Followed['mode'] = worldScoped ? 'worldEntity' : 'entity';
          this.backToken.set(worldScoped ? token : null);
          const read$ = worldScoped
            ? this.client.worldEntity(token, params.get('entityId') ?? '')
            : this.client.entity(token);
          return read$.pipe(
            tap((entity) => this.followed.set({ token, mode, id: entity.id })),
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

    // Live-follow the open Entity. watchEntity() connects the bus as this token principal and
    // relays nudges into a refetch-and-replace; EVICTED (link revoked, deleted, a 403/404 refetch)
    // → the dead-link panel. switchMap off `followed` tears down the old follow (reverting the
    // token principal) when the Entity swaps.
    toObservable(this.followed)
      .pipe(
        switchMap((f) =>
          f === null ? EMPTY : this.client.watchEntity(f.token, f.mode, f.id, (n) => this.wantsRefetch(n)),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => (result === EVICTED ? this.evict() : this.session.adopt(result)));
  }

  /** Strictly past the freshness key the open Entity carries (ADR-0045). */
  private newerThanHeld(n: EntityNudge): boolean {
    const held = this.session.current();
    return !!held && n.seq > held.seq;
  }

  /** A `stale` reconnect pulse always refetches (no `seq` — `||` order matters); else newer-than-held (#177). */
  private wantsRefetch(n: EntityNudge | StaleNudge): boolean {
    return 'stale' in n || this.newerThanHeld(n);
  }

  /** Blank to the dead-link panel: access ended on the open screen (revoked / deleted). */
  private evict(): void {
    this.followed.set(null);
    this.notFound.set(true);
  }
}
