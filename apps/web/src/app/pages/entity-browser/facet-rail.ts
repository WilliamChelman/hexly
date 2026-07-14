import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets } from '@hexly/domain';
import { TypeRegistry } from '../../entity-types/type-registry';

/** One type's Field selection (ADR-0048, #188): eq membership for enum/list/string, or a
 * `gte`/`lte` range for number/date. Absent parts mean "unconstrained on that axis". */
export interface FieldSelection {
  readonly values?: readonly string[];
  readonly gte?: string;
  readonly lte?: string;
}

/** Whether a Field selection constrains nothing — no eq values and neither range bound. The one
 * definition of "empty" the rail's visibility and the browser's URL-pruning both read. */
export function isFieldSelectionEmpty(sel: FieldSelection): boolean {
  return (sel.values?.length ?? 0) === 0 && !sel.gte && !sel.lte;
}

export interface ActiveFacets {
  readonly type: readonly string[];
  readonly tag: readonly string[];
  readonly visibility: readonly string[];
  /** The active Field filters, keyed by EntityDocument key — the contextual dimension (ADR-0048, #188). */
  readonly fields: Readonly<Record<string, FieldSelection>>;
}

/** The universal facet categories — the closed trio that is always present. */
export type FacetCategory = 'type' | 'tag' | 'visibility';

export interface FacetToggle {
  readonly category: FacetCategory;
  readonly value: string;
}

/** A toggle of one enum/list/string Field-facet value (eq membership). */
export interface FieldValueToggle {
  readonly key: string;
  readonly value: string;
}

/** A change to one bound of a number/date Field range; `value` empty clears that bound. */
export interface FieldRangeChange {
  readonly key: string;
  readonly bound: 'gte' | 'lte';
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
    <div data-testid="facet-rail" class="rounded-sm border border-line bg-surface p-4">
      <div class="flex items-center justify-between mb-3">
        <span class="font-sans text-xs uppercase tracking-[0.18em] text-ink-faint">{{
          'entityBrowser.facets.heading' | transloco
        }}</span>
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

      <!-- Contextual Field facets: unfold only when a type is the active filter (ADR-0048, #188).
           The Field's data-type picks the control — value toggles for enum/list/string, a range for
           number/date. -->
      @for (field of fieldFacets(); track field.key) {
        <section class="mb-4 last:mb-0" [attr.data-testid]="'facet-field-' + field.key">
          <h3 class="font-sans text-xs font-semibold text-ink-strong m-0 mb-2">
            {{ field.label }}
          </h3>
          @if (field.kind === 'range') {
            <div class="flex items-center gap-2">
              <input
                [type]="field.inputType"
                [attr.data-testid]="'facet-field-' + field.key + '-gte'"
                [attr.aria-label]="field.minLabel"
                [value]="field.gte"
                [attr.placeholder]="field.min"
                class="w-full min-w-0 rounded border border-line bg-surface px-2 py-1 font-sans text-sm"
                (change)="emitRange(field.key, 'gte', $event)"
              />
              <span class="text-ink-faint" aria-hidden="true">–</span>
              <input
                [type]="field.inputType"
                [attr.data-testid]="'facet-field-' + field.key + '-lte'"
                [attr.aria-label]="field.maxLabel"
                [value]="field.lte"
                [attr.placeholder]="field.max"
                class="w-full min-w-0 rounded border border-line bg-surface px-2 py-1 font-sans text-sm"
                (change)="emitRange(field.key, 'lte', $event)"
              />
            </div>
          } @else {
            <ul class="flex flex-col gap-1 m-0 p-0 list-none">
              @for (row of field.rows; track row.value) {
                <li>
                  <button
                    type="button"
                    [attr.data-testid]="'facet-field-' + field.key + '-' + row.value"
                    [attr.aria-pressed]="row.active"
                    class="w-full flex items-center justify-between px-2 py-1 rounded-sm font-sans text-sm text-left text-ink-strong hover:bg-surface-sunken aria-pressed:bg-gold/15 aria-pressed:text-gold"
                    (click)="
                      fieldValueToggled.emit({
                        key: field.key,
                        value: row.value,
                      })
                    "
                  >
                    <span class="truncate">{{ row.label }}</span>
                    <span class="ml-2 text-ink-faint tabular-nums">{{ row.count }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
})
export class FacetRail {
  private readonly transloco = inject(TranslocoService);
  private readonly types = inject(TypeRegistry);

  readonly facetCounts = input<EntityFacets>({
    type: [],
    tag: [],
    visibility: [],
    fields: [],
  });
  readonly active = input<ActiveFacets>({
    type: [],
    tag: [],
    visibility: [],
    fields: {},
  });
  readonly canClear = input(false);

  readonly toggled = output<FacetToggle>();
  readonly fieldValueToggled = output<FieldValueToggle>();
  readonly fieldRangeChanged = output<FieldRangeChange>();
  readonly clearAll = output<void>();

  protected emitRange(key: string, bound: 'gte' | 'lte', event: Event): void {
    this.fieldRangeChanged.emit({
      key,
      bound,
      value: (event.target as HTMLInputElement).value,
    });
  }

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
        // A user-defined type's authored name; a code type's translated copy (#191).
        label: (v: string) => this.types.name(v),
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

  /**
   * The contextual Field facets as render rows (ADR-0048, #188). Each Field's data-type picks its
   * control: number/date render a range bounded by the live min/max of its values; everything else
   * renders toggle rows. A Field with no live values and no active selection is dropped, so the rail
   * shows no empty section.
   */
  protected readonly fieldFacets = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-translate the range aria-labels on switch
    const activeFields = this.active().fields;
    return this.facetCounts()
      .fields.map((field) => {
        const selection = activeFields[field.key] ?? {};
        const numeric = field.dataType.kind === 'number';
        const range = numeric || field.dataType.kind === 'date';
        const rows = field.values.map((v) => ({
          value: v.value,
          count: v.count,
          // An Entity-Link facet's value is a target id; the server sends its name as `label` (#190).
          label: v.label ?? v.value,
          active: (selection.values ?? []).includes(v.value),
        }));
        return {
          key: field.key,
          label: field.label,
          kind: range ? ('range' as const) : ('values' as const),
          // A date range wants a date picker; every other range is numeric.
          inputType: field.dataType.kind === 'date' ? 'date' : 'number',
          minLabel: this.transloco.translate('entityBrowser.facets.rangeMin', {
            field: field.label,
          }),
          maxLabel: this.transloco.translate('entityBrowser.facets.rangeMax', {
            field: field.label,
          }),
          gte: selection.gte ?? '',
          lte: selection.lte ?? '',
          // Placeholder bounds hint the available span. A number range compares numerically, so its
          // min/max are the numeric extremes — not the lexical first/last of the sorted values.
          ...rangeBounds(
            field.values.map((v) => v.value),
            numeric,
          ),
          rows,
          // Keep a Field visible when it has values to offer or an active constraint to show/clear.
          visible: rows.length > 0 || !isFieldSelectionEmpty(selection),
        };
      })
      .filter((f) => f.visible);
  });
}

/**
 * The placeholder min/max for a range facet's inputs. A numeric Field's extremes are the numeric
 * min/max (the server sorts values as text, so the first/last are the *lexical* ends — wrong for
 * numbers); a date Field's ISO strings sort correctly as text, so its first/last already are the ends.
 */
function rangeBounds(values: readonly string[], numeric: boolean): { min: string; max: string } {
  if (!values.length) return { min: '', max: '' };
  if (numeric) {
    const nums = values.map(Number).filter((n) => Number.isFinite(n));
    if (nums.length) return { min: String(Math.min(...nums)), max: String(Math.max(...nums)) };
  }
  return { min: values[0], max: values[values.length - 1] };
}
