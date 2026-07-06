import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, of, switchMap } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { PublicClient } from '../../core/services/public.client';
import { AppShellStore } from '../../shell/app-shell.store';
import { EntitySession } from '../entity/services/entity-session';
import { EntityNameResolver } from '../entity/services/entity-name-resolver';
import { PublicEntityNameResolver } from './public-entity-name-resolver';
import { OutlineStore } from '../entity/services/outline-store';
import { EntityPage } from '../entity/entity.page';

/**
 * A Public Link Entity page (ADR-0037, #162): reuses the real {@link EntityPage} in its
 * read-only mode rather than a bespoke renderer, so a public reader gets full-fidelity
 * Content and hex maps for free. The entity comes from the token route (not the
 * authenticated load), so this fetches via {@link PublicClient} and hands it to
 * {@link EntitySession.adopt}; the server ships it with `rights: ['read']` (no `edit`), which
 * drives the whole editor read-only (no autosave, no edit chrome).
 *
 * It provides the same route-scoped stores as `/entities/:id` so the reused EntityPage and
 * its content editor resolve one shared session — but marks that session externally driven
 * (constructor) so EntityPage's `watchRoute` never fires an authenticated load; this component
 * is the sole data source. The {@link EntityNameResolver} is swapped for the
 * {@link PublicEntityNameResolver}, which resolves no in-content Entity Links at all — a Public
 * Link grants only its own scope, so cross-references render as their frozen label (dangling)
 * rather than doing a scope-widening lookup or hitting the session-guarded `/api/entities`.
 */
@Component({
  selector: 'app-public-entity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col' },
  providers: [
    EntitySession,
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

  /** True once a token failed to resolve (revoked/bad) — shows the calm dead-link panel. */
  readonly notFound = signal(false);
  /** The World token to offer a back link to, for a world-scoped page; null for a bare link. */
  readonly backToken = signal<string | null>(null);

  constructor() {
    // Sole data source (#162): mark the shared session external before the reused EntityPage
    // mounts, so its watchRoute never fires an authenticated load over the adopted Entity.
    this.session.markExternallyDriven();

    this.shell.standalone.set(true);
    inject(DestroyRef).onDestroy(() => this.shell.standalone.set(false));

    combineLatest([this.route.paramMap, this.route.data])
      .pipe(
        switchMap(([params, data]) => {
          this.notFound.set(false);
          const token = params.get('token') ?? '';
          const worldScoped = data['mode'] === 'worldEntity';
          this.backToken.set(worldScoped ? token : null);
          const read$ = worldScoped
            ? this.client.worldEntity(token, params.get('entityId') ?? '')
            : this.client.entity(token);
          return read$.pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((entity) => {
        if (entity) this.session.adopt(entity);
        else this.notFound.set(true);
      });
  }
}
