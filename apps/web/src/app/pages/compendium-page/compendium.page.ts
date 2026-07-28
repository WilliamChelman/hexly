import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { CompendiumSummary } from '@hexly/domain';
import { ActiveWorld, AppShellStore, CompendiumsClient, idFromSegment, worldCompendiumRoute } from '@hexly/web-core';
import { EyebrowComponent, PageHeaderComponent, PanelComponent } from '@hexly/web-ui';
import { EmptyStateComponent } from '../entity-browser/components/empty-state.component';

/**
 * A **Compendium page** (`/w/:worldId/compendium/:compendiumId`, ADR-0079, #402): one installed pack,
 * and the terms its content is published under.
 *
 * ADR-0061 satisfies the Draw Steel Creator License with a `NOTICE.md` in the plugin's source tree,
 * which the person reading the monsters never opens. This states publisher, license and notice where
 * that content is browsed — and gives a future user-published pack somewhere to state its own.
 *
 * Readable by anyone signed in, like the entries: Instance-wide with no members means being on this
 * Instance *is* the standing (ADR-0078), so there is no per-caller rule here and none to invent.
 *
 * Every term renders only if the pack recorded it, and a pack that recorded none renders no terms
 * section at all — attribution arrives with its absent parts absent, never as a row of nulls.
 */
@Component({
  selector: 'app-compendium-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, EyebrowComponent, PageHeaderComponent, PanelComponent, RouterLink, TranslocoPipe],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col min-w-0">
        <span appEyebrow class="text-accent-strong! tracking-[0.28em]">{{ 'compendium.eyebrow' | transloco }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight truncate" data-testid="compendium-name">
          {{ pack()?.name ?? ('compendium.page.heading' | transloco) }}
        </h1>
      </div>
      <a
        pageHeaderActions
        class="font-sans text-xs text-accent-strong hover:underline"
        data-testid="compendium-back"
        [routerLink]="browseRoute()"
        >{{ 'compendium.page.backToBrowse' | transloco }}</a
      >
    </app-page-header>

    <main class="max-w-[48rem] mx-auto py-8 px-6">
      @if (pack(); as compendium) {
        <section appPanel class="p-6" data-testid="compendium-detail">
          <!-- "Which version of the bestiary is this" — the pinned revision, always recorded. -->
          <p class="font-sans text-xs text-ink-faint m-0" data-testid="compendium-rev">
            {{ 'compendium.page.revision' | transloco: { rev: compendium.rev } }}
          </p>

          @if (hasTerms()) {
            <dl class="m-0 mt-6 flex flex-col gap-5" data-testid="compendium-attribution">
              @if (compendium.attribution.publisher; as publisher) {
                <div>
                  <dt class="font-sans text-xs uppercase tracking-[0.18em] text-ink-faint">
                    {{ 'compendium.page.publisher' | transloco }}
                  </dt>
                  <dd class="m-0 mt-1 font-sans text-sm text-ink-strong" data-testid="compendium-publisher">
                    {{ publisher }}
                  </dd>
                </div>
              }
              @if (compendium.attribution.license; as license) {
                <div>
                  <dt class="font-sans text-xs uppercase tracking-[0.18em] text-ink-faint">
                    {{ 'compendium.page.license' | transloco }}
                  </dt>
                  <dd class="m-0 mt-1 font-sans text-sm text-ink-strong" data-testid="compendium-license">
                    {{ license }}
                  </dd>
                </div>
              }
              @if (compendium.attribution.notice; as notice) {
                <div>
                  <dt class="font-sans text-xs uppercase tracking-[0.18em] text-ink-faint">
                    {{ 'compendium.page.notice' | transloco }}
                  </dt>
                  <!-- Verbatim, line breaks kept: a notice is a legal string, not prose to reflow. -->
                  <dd
                    class="m-0 mt-1 font-sans text-sm text-ink-strong whitespace-pre-line"
                    data-testid="compendium-notice"
                  >
                    {{ notice }}
                  </dd>
                </div>
              }
            </dl>
          }
        </section>
      } @else if (notFound()) {
        <app-empty-state
          testid="compendium-not-found"
          [title]="'compendium.page.notFoundTitle' | transloco"
          [hint]="'compendium.page.notFoundHint' | transloco"
        />
      } @else if (loadError()) {
        <app-empty-state
          testid="load-error"
          [title]="'compendium.loadErrorTitle' | transloco"
          [hint]="'compendium.loadErrorHint' | transloco"
        />
      }
    </main>
  `,
})
export class CompendiumPage {
  private readonly compendiums = inject(CompendiumsClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly route = inject(ActivatedRoute);
  private readonly shell = inject(AppShellStore);

  private readonly _pack = signal<CompendiumSummary | null>(null);
  protected readonly pack = this._pack.asReadonly();
  protected readonly notFound = signal(false);
  protected readonly loadError = signal(false);

  /**
   * Whether the pack stated any terms at all. False renders nothing rather than a heading with no
   * value under it — the empty scaffold #402 exists to avoid.
   */
  protected readonly hasTerms = computed(() => Object.keys(this._pack()?.attribution ?? {}).length > 0);

  /** Back to the browse this page hangs off, in the World it was browsed from. */
  protected readonly browseRoute = computed(() =>
    worldCompendiumRoute(this.activeWorld.worldId() ?? '', this.activeWorld.name() ?? undefined),
  );

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => idFromSegment(params.get('compendiumId') ?? '')),
        takeUntilDestroyed(),
      )
      .subscribe((id) => this.load(id));
  }

  private load(id: string): void {
    this._pack.set(null);
    this.notFound.set(false);
    this.loadError.set(false);
    this.compendiums
      .get(id)
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (pack) => this._pack.set(pack),
        // An id naming no installed pack is the ordinary case here — a link kept after an operator
        // removed the pack — so it is said plainly rather than toasted as a failure.
        error: (err: unknown) =>
          err instanceof HttpErrorResponse && err.status === 404 ? this.notFound.set(true) : this.loadError.set(true),
      });
  }
}
