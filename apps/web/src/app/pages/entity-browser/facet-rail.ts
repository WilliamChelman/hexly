import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets } from '@hexly/domain';

export interface ActiveFacets {
  readonly type: readonly string[];
  readonly tag: readonly string[];
  readonly visibility: readonly string[];
}

export type FacetCategory = keyof ActiveFacets;

export interface FacetToggle {
  readonly category: FacetCategory;
  readonly value: string;
}

/**
 * The Facet rail beside the Entity Browser grid. Controlled — the parent owns
 * the active selections and count data; the rail renders them and emits
 * {@link toggled}/{@link clearAll}. Clicking an active value toggles it off.
 */
@Component({
  selector: 'app-facet-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  host: { class: 'block' },
  template: `
    <div
      data-testid="facet-rail"
      class="rounded-sm border border-line bg-surface p-4"
    >
      <div class="flex items-center justify-between mb-3">
        <span
          class="font-sans text-xs uppercase tracking-[0.18em] text-ink-faint"
          >{{ 'entityBrowser.facets.heading' | transloco }}</span
        >
        @if (canClear()) {
          <button
            type="button"
            data-testid="facet-clear"
            class="font-sans text-xs text-gold hover:underline"
            (click)="clearAll.emit()"
          >
            {{ 'entityBrowser.facets.clearAll' | transloco }}
          </button>
        }
      </div>

      @for (group of groups(); track group.category) {
        <section class="mb-4 last:mb-0">
          <h3
            class="font-sans text-xs font-semibold text-ink-strong m-0 mb-2"
            [attr.data-testid]="'facet-heading-' + group.category"
          >
            {{ 'entityBrowser.facets.' + group.category | transloco }}
          </h3>
          <ul class="flex flex-col gap-1 m-0 p-0 list-none">
            @for (row of group.rows; track row.value) {
              <li>
                <button
                  type="button"
                  [attr.data-testid]="'facet-' + group.category + '-' + row.value"
                  [attr.aria-pressed]="row.active"
                  class="w-full flex items-center justify-between px-2 py-1 rounded-sm font-sans text-sm text-left text-ink-strong hover:bg-surface-sunken aria-pressed:bg-gold/15 aria-pressed:text-gold"
                  (click)="toggled.emit({ category: group.category, value: row.value })"
                >
                  <span class="truncate">{{ row.label }}</span>
                  <span class="ml-2 text-ink-faint tabular-nums">{{ row.count }}</span>
                </button>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class FacetRail {
  private readonly transloco = inject(TranslocoService);

  readonly facetCounts = input<EntityFacets>({ type: [], tag: [], visibility: [] });
  readonly active = input<ActiveFacets>({ type: [], tag: [], visibility: [] });
  readonly canClear = input(false);

  readonly toggled = output<FacetToggle>();
  readonly clearAll = output<void>();

  /** Categories as render rows. Type/Visibility labels are translated; a Tag
   * shows its raw text. Empty categories are dropped — no bare headings. */
  protected readonly groups = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-translate labels on switch
    const active = this.active();
    const counts = this.facetCounts();
    const categories = [
      {
        category: 'type' as const,
        rows: counts.type,
        label: (v: string) => this.transloco.translate(`entityBrowser.type.${v}`),
      },
      { category: 'tag' as const, rows: counts.tag, label: (v: string) => v },
      {
        category: 'visibility' as const,
        rows: counts.visibility,
        label: (v: string) => this.transloco.translate(`entityBrowser.facets.${v}`),
      },
    ];
    return categories
      .filter((g) => g.rows.length > 0)
      .map((g) => ({
        category: g.category,
        rows: g.rows.map((r) => ({
          value: r.value,
          count: r.count,
          label: g.label(r.value),
          active: active[g.category].includes(r.value),
        })),
      }));
  });
}
