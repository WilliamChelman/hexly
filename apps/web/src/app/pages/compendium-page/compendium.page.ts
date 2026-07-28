import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { CompendiumSummary } from '@hexly/domain';
import {
  ActiveWorld,
  AppShellStore,
  CompendiumsClient,
  TitleService,
  idFromSegment,
  worldCompendiumRoute,
} from '@hexly/web-core';
import { EyebrowComponent, PageHeaderComponent, PanelComponent } from '@hexly/web-ui';
import { EmptyStateComponent } from '../entity-browser/components/empty-state.component';

/** One recorded term as the page renders it — absent terms never become a row (CONTEXT.md → Compendium page). */
interface TermRow {
  readonly key: 'publisher' | 'license' | 'notice';
  readonly value: string;
}

/**
 * The **Compendium page** (CONTEXT.md), `/w/:worldId/compendium/:compendiumId`: one installed
 * Compendium and the terms its content is published under, where that content is read rather than in
 * the plugin's source tree (ADR-0061).
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
          {{ compendium()?.name ?? ('compendium.page.heading' | transloco) }}
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
      @if (compendium(); as installed) {
        <section appPanel class="p-6" data-testid="compendium-detail">
          <!-- The revision these terms attach to: the pin only moves in a code change (ADR-0061). -->
          <p class="font-sans text-xs text-ink-faint m-0" data-testid="compendium-rev">
            {{ 'compendium.page.revision' | transloco: { rev: installed.rev } }}
          </p>

          @if (terms().length > 0) {
            <dl class="m-0 mt-6 flex flex-col gap-5" data-testid="compendium-attribution">
              @for (term of terms(); track term.key) {
                <div>
                  <dt class="font-sans text-xs uppercase tracking-[0.18em] text-ink-faint">
                    {{ 'compendium.page.' + term.key | transloco }}
                  </dt>
                  <!-- Verbatim, line breaks kept: a notice is a legal string, not prose to reflow. -->
                  <dd
                    class="m-0 mt-1 font-sans text-sm text-ink-strong whitespace-pre-line"
                    [attr.data-testid]="'compendium-' + term.key"
                  >
                    {{ term.value }}
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

  private readonly _compendium = signal<CompendiumSummary | null>(null);
  protected readonly compendium = this._compendium.asReadonly();
  protected readonly notFound = signal(false);
  protected readonly loadError = signal(false);

  /**
   * The terms actually recorded, in reading order. Derived rather than templated per key so "did it
   * record anything" and "what is rendered" cannot disagree: a Compendium stating none yields no rows
   * and so no section — the empty scaffold #402 exists to avoid.
   */
  protected readonly terms = computed<TermRow[]>(() => {
    const attribution = this._compendium()?.attribution ?? {};
    return (['publisher', 'license', 'notice'] as const)
      .map((key) => ({ key, value: attribution[key] }))
      .filter((term): term is TermRow => !!term.value);
  });

  /** Back to the browse this page hangs off, in the World it was browsed from. */
  protected readonly browseRoute = computed(() =>
    worldCompendiumRoute(this.activeWorld.worldId() ?? '', this.activeWorld.name() ?? undefined),
  );

  constructor() {
    // The tab names the Compendium, not the destination — this page is meant to be sent to someone
    // (ADR-0014); cleared on leave or a stale name shadows the next page's title.
    const titles = inject(TitleService);
    effect(() => titles.setDocumentName(this._compendium()?.name ?? null));
    inject(DestroyRef).onDestroy(() => titles.setDocumentName(null));

    this.route.paramMap
      .pipe(
        map((params) => idFromSegment(params.get('compendiumId') ?? '')),
        takeUntilDestroyed(),
      )
      .subscribe((id) => this.load(id));
  }

  private load(id: string): void {
    this._compendium.set(null);
    this.notFound.set(false);
    this.loadError.set(false);
    this.compendiums
      .get(id)
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (installed) => this._compendium.set(installed),
        // An id naming no installed Compendium is ordinary here — a link kept after an operator removed
        // it — so it is said plainly rather than toasted as a failure.
        error: (err: unknown) =>
          err instanceof HttpErrorResponse && err.status === 404 ? this.notFound.set(true) : this.loadError.set(true),
      });
  }
}
