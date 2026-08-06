import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityFacets, FacetCount } from '@hexly/domain';
import { ClientConfigStore } from '@hexly/web-core';
import { TypeRegistry } from '../../../entity-types/type-registry';

/** One type's Field selection (ADR-0048, #188): eq membership for enum/list/string, or a
 * `gte`/`lte` range for number/date. Absent parts mean "unconstrained on that axis".
 * `excluded` is the `neq` half (ADR-0081) — it vetoes, so it beats an `eq` on the same value.
 * A range takes no polarity: a negated bound says nothing `gte`/`lte` cannot. */
export interface FieldSelection {
  readonly values?: readonly string[];
  readonly excluded?: readonly string[];
  readonly gte?: string;
  readonly lte?: string;
}

/** Whether a Field selection constrains nothing — no eq values, no exclusion, neither range bound.
 * The one definition of "empty" the rail's visibility and the browser's URL-pruning both read. */
export function isFieldSelectionEmpty(sel: FieldSelection): boolean {
  return (sel.values?.length ?? 0) === 0 && (sel.excluded?.length ?? 0) === 0 && !sel.gte && !sel.lte;
}

/** Set one value's polarity and release the other, which is what puts the both-selected
 * contradiction out of the rail's reach (ADR-0081); pressing the lit half returns it to neutral. */
export function togglePolarity(
  included: readonly string[],
  excluded: readonly string[],
  value: string,
  polarity: FacetPolarity,
): { included: readonly string[]; excluded: readonly string[] } {
  const drop = (vs: readonly string[]) => vs.filter((v) => v !== value);
  const flip = (vs: readonly string[]) => (vs.includes(value) ? drop(vs) : [...vs, value]);
  return polarity === 'include'
    ? { included: flip(included), excluded: drop(excluded) }
    : { included: drop(included), excluded: flip(excluded) };
}

export interface ActiveFacets {
  readonly type: readonly string[];
  readonly tag: readonly string[];
  readonly visibility: readonly string[];
  /** The active Field filters, keyed by EntityDocument key — the contextual dimension (ADR-0048, #188). */
  readonly fields: Readonly<Record<string, FieldSelection>>;
  /**
   * The selected **Containers** — Container ids (ADR-0079's Pack facet, widened by ADR-0080). Only the
   * **Library** fills it: the server offers the category by presence, and a browse scoped to one
   * Container has nothing to narrow, so every other browse leaves it empty and the rail drops the
   * section.
   */
  readonly container: readonly string[];
  /**
   * The excluding half of each value-toggled category (ADR-0081): a value here **vetoes**, whatever
   * the includes say. Partial, and silent about the categories a browse pins or strips — the Asset
   * Browser's Type, the Library's Visibility — which never reach the rail to be toggled either way.
   */
  readonly excluded?: Partial<Record<FacetCategory, readonly string[]>>;
}

/**
 * The value-toggled facet categories: the universal trio, plus the **Container**, which the server
 * offers only where a read spans more than one Container.
 */
export type FacetCategory = 'type' | 'tag' | 'visibility' | 'container';

/**
 * The displayed values the *text* owns, in either polarity — a value has one visual state whichever way
 * it was named (ADR-0082). Empty wherever no **Facet Token** parse stands behind the rail.
 */
export interface QueryOwnedFacets {
  readonly categories?: Partial<Record<FacetCategory, readonly string[]>>;
  /** Per Facet key, the values a token named — never a bound, which is no row to click off. */
  readonly fields?: Readonly<Record<string, readonly string[]>>;
}

/** The outline that tells a typed value from a clicked one; transparent otherwise, so a row neither
 * shifts nor resizes as the text takes it over. One rule, worn by both of a row's controls. */
function queryOwnedOutline(queryOwned: boolean): string {
  return queryOwned ? 'border border-dashed border-accent' : 'border border-transparent';
}

/** Which half of a value's polarity a click addressed (ADR-0081). */
export type FacetPolarity = 'include' | 'exclude';

export interface FacetToggle {
  readonly category: FacetCategory;
  readonly value: string;
  readonly polarity: FacetPolarity;
}

/** A toggle of one enum/list/string Field-facet value — `eq` membership, or its `neq` veto. */
export interface FieldValueToggle {
  readonly key: string;
  readonly value: string;
  readonly polarity: FacetPolarity;
}

/** A change to one bound of a number/date Field range; `value` empty clears that bound. */
export interface FieldRangeChange {
  readonly key: string;
  readonly bound: 'gte' | 'lte';
  readonly value: string;
}

/**
 * The small `−` beside a rail row's include toggle (ADR-0081). Its own component so a category row
 * and a Field row cannot drift apart, and always rendered where it is offered — hover-revealing it
 * would break touch and add a surprise tab stop.
 */
@Component({
  selector: 'app-facet-exclude-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    <button
      type="button"
      [attr.data-testid]="testid()"
      [attr.data-query-owned]="queryOwned() ? '' : null"
      [attr.aria-pressed]="pressed()"
      [attr.aria-label]="
        (queryOwned() ? 'entityBrowser.facets.removeTyped' : 'entityBrowser.facets.excludeValue')
          | transloco: { value: label() }
      "
      class="shrink-0 w-6 flex items-center justify-center rounded-sm font-sans text-sm text-ink-faint hover:bg-surface-sunken aria-pressed:bg-danger-soft aria-pressed:text-danger"
      [class]="outline(queryOwned())"
      (click)="press.emit()"
    >
      <span aria-hidden="true">−</span>
    </button>
  `,
})
export class FacetExcludeToggleComponent {
  readonly testid = input.required<string>();
  readonly pressed = input.required<boolean>();
  /** Whether the *text* put this value in force (ADR-0082): pressing it takes the token out of the box. */
  readonly queryOwned = input(false);
  /** The row's rendered label — the exclude control names itself with it, the include one carries it. */
  readonly label = input.required<string>();
  readonly press = output<void>();

  protected readonly outline = queryOwnedOutline;
}

/**
 * The Facet rail beside the Entity Browser grid. Controlled — the parent owns
 * the active selections and count data; the rail renders them and emits
 * {@link toggled}/{@link clearAll}. Clicking an active value toggles it off.
 */
@Component({
  selector: 'app-facet-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, FacetExcludeToggleComponent],
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
            class="font-sans text-xs text-accent-strong hover:underline"
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
              <li class="flex items-stretch gap-1">
                <button
                  type="button"
                  [attr.data-testid]="'facet-' + group.category + '-' + row.value"
                  [attr.data-query-owned]="row.queryOwned ? '' : null"
                  [attr.aria-pressed]="row.active"
                  [attr.aria-label]="
                    row.queryOwned ? ('entityBrowser.facets.removeTyped' | transloco: { value: row.label }) : null
                  "
                  class="flex-1 min-w-0 flex items-center justify-between px-2 py-1 rounded-sm font-sans text-sm text-left text-ink-strong hover:bg-surface-sunken aria-pressed:bg-accent/15 aria-pressed:text-accent-strong"
                  [class]="outline(row.queryOwned)"
                  (click)="toggled.emit({ category: group.category, value: row.value, polarity: 'include' })"
                >
                  <span class="min-w-0 flex items-baseline gap-1">
                    <!-- The dollar the caller typed, kept beside the value it named (ADR-0082). -->
                    @if (row.queryOwned) {
                      <span aria-hidden="true" class="shrink-0 font-mono text-accent-strong">$</span>
                    }
                    <span class="truncate">{{ row.label }}</span>
                  </span>
                  <span class="ml-2 text-ink-faint tabular-nums">{{ row.count }}</span>
                </button>
                @if (canExclude()) {
                  <app-facet-exclude-toggle
                    [testid]="'facet-exclude-' + group.category + '-' + row.value"
                    [pressed]="row.excluded"
                    [queryOwned]="row.queryOwned"
                    [label]="row.label"
                    (press)="toggled.emit({ category: group.category, value: row.value, polarity: 'exclude' })"
                  />
                }
              </li>
            }
          </ul>
        </section>
      }

      <!-- Field facets, surfaced by presence in the result set — the server offers a Field whenever the
           current browse carries values for it, whatever types those entities hold (ADR-0054, #231). The
           Field's data-type picks the control — value toggles for enum/list/string, a range for number/date. -->
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
                class="w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 font-sans text-sm"
                (change)="emitRange(field.key, 'gte', $event)"
              />
              <span class="text-ink-faint" aria-hidden="true">–</span>
              <input
                [type]="field.inputType"
                [attr.data-testid]="'facet-field-' + field.key + '-lte'"
                [attr.aria-label]="field.maxLabel"
                [value]="field.lte"
                [attr.placeholder]="field.max"
                class="w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 font-sans text-sm"
                (change)="emitRange(field.key, 'lte', $event)"
              />
            </div>
          } @else {
            <ul class="flex flex-col gap-1 m-0 p-0 list-none">
              @for (row of field.rows; track row.value) {
                <li class="flex items-stretch gap-1">
                  <button
                    type="button"
                    [attr.data-testid]="'facet-field-' + field.key + '-' + row.value"
                    [attr.data-query-owned]="row.queryOwned ? '' : null"
                    [attr.aria-pressed]="row.active"
                    [attr.aria-label]="
                      row.queryOwned ? ('entityBrowser.facets.removeTyped' | transloco: { value: row.label }) : null
                    "
                    class="flex-1 min-w-0 flex items-center justify-between px-2 py-1 rounded-sm font-sans text-sm text-left text-ink-strong hover:bg-surface-sunken aria-pressed:bg-accent/15 aria-pressed:text-accent-strong"
                    [class]="outline(row.queryOwned)"
                    (click)="
                      fieldValueToggled.emit({
                        key: field.key,
                        value: row.value,
                        polarity: 'include',
                      })
                    "
                  >
                    <span class="min-w-0 flex items-baseline gap-1">
                      @if (row.queryOwned) {
                        <span aria-hidden="true" class="shrink-0 font-mono text-accent-strong">$</span>
                      }
                      <span class="truncate">{{ row.label }}</span>
                    </span>
                    <span class="ml-2 text-ink-faint tabular-nums">{{ row.count }}</span>
                  </button>
                  @if (canExclude()) {
                    <app-facet-exclude-toggle
                      [testid]="'facet-exclude-field-' + field.key + '-' + row.value"
                      [pressed]="row.excluded"
                      [queryOwned]="row.queryOwned"
                      [label]="row.label"
                      (press)="
                        fieldValueToggled.emit({
                          key: field.key,
                          value: row.value,
                          polarity: 'exclude',
                        })
                      "
                    />
                  }
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
})
export class FacetRailComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly types = inject(TypeRegistry);
  private readonly clientConfig = inject(ClientConfigStore);

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
    container: [],
  });
  /**
   * The displayed values a **Facet Token** put in force (ADR-0082). Rendering only: the rail emits the
   * same toggle either way, and the page decides that a click on one of these deletes the token.
   */
  readonly queryOwned = input<QueryOwnedFacets>({});
  readonly canClear = input(false);
  /** Whether this browse offers the excluding half (ADR-0081); off by default, so the rail is never
   * given a control whose param its page does not carry. Every rail surface passes it since #423 —
   * the shared `field` codec's `neq` guard is the same rule, on the other side of the URL. */
  readonly canExclude = input(false);

  readonly toggled = output<FacetToggle>();
  readonly fieldValueToggled = output<FieldValueToggle>();
  readonly fieldRangeChanged = output<FieldRangeChange>();
  readonly clearAll = output<void>();

  protected readonly outline = queryOwnedOutline;

  protected emitRange(key: string, bound: 'gte' | 'lte', event: Event): void {
    this.fieldRangeChanged.emit({
      key,
      bound,
      value: (event.target as HTMLInputElement).value,
    });
  }

  /**
   * One facet value's display label (ADR-0055/0065). A harvested dimension carries a `valuesKeyPrefix`, so
   * its enum value translates as `<prefix>.<value>`; an untranslated value (or a scalar Field, which has no
   * prefix) falls back to the raw token — an Entity-Link facet's server-sent `label`, else the value (#190).
   */
  private valueLabel(prefix: string | undefined, value: FacetCount): string {
    if (prefix) {
      const key = `${prefix}.${value.value}`;
      const translated = this.transloco.translate(key);
      if (translated !== key) return translated;
    }
    return value.label ?? value.value;
  }

  /** Categories as render rows, each merged with what the caller has selected (ADR-0081, #420).
   * Type/Visibility labels are translated; a Tag shows its raw text. Empty categories are dropped —
   * no bare headings. */
  protected readonly groups = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-translate labels on switch
    const active = this.active();
    const excluded = active.excluded ?? {};
    const owned = this.queryOwned().categories ?? {};
    const counts = this.facetCounts();
    const categories = [
      {
        category: 'type' as const,
        rows: withSelection(counts.type, active.type, excluded.type),
        // A user-defined type's authored name; a code type's translated copy (#191).
        label: (v: FacetCount) => this.types.name(v.value),
      },
      {
        category: 'tag' as const,
        rows: withSelection(counts.tag, active.tag, excluded.tag),
        label: (v: FacetCount) => v.value,
      },
      {
        category: 'visibility' as const,
        // Nothing reads Visibility with Collaboration off (ADR-0071); emptied, the category falls to
        // the drop-empties filter below — a selection can't resurrect it, so the merge stays inside the gate.
        rows: this.clientConfig.isCollaborationEnabled()
          ? withSelection(counts.visibility, active.visibility, excluded.visibility)
          : [],
        label: (v: FacetCount) => this.transloco.translate(`entityBrowser.facets.${v.value}`),
      },
      {
        // The **Container** (ADR-0079, ADR-0080): a Container id labelled with its authored name, which
        // the server sends beside the count — nothing client-side knows what a Container is called —
        // and in the order the read named its Containers, which in the Library is the Owner's Mount
        // order. Absent wherever the read names a single Container, so every other browse drops it.
        category: 'container' as const,
        rows: withSelection(counts.container ?? [], active.container, excluded.container),
        label: (v: FacetCount) => v.label ?? v.value,
      },
    ];
    return categories
      .filter((g) => g.rows.length > 0)
      .map((g) => ({
        category: g.category,
        rows: g.rows.map((r) => ({
          value: r.value,
          count: r.count,
          label: g.label(r),
          active: active[g.category].includes(r.value),
          excluded: (excluded[g.category] ?? []).includes(r.value),
          queryOwned: (owned[g.category] ?? []).includes(r.value),
        })),
      }));
  });

  /**
   * The contextual Field facets as render rows (ADR-0048, #188, #235). Each Field's data-type picks its
   * control: number/date render a range bounded by the live min/max of its values; everything else
   * renders toggle rows. A Field with no live values and no active selection is dropped, so the rail
   * shows no empty section. A harvested-dimension facet carries a `labelKey` the active Locale
   * translates; a scalar Field's authored `label` is shown as-is (ADR-0055).
   */
  protected readonly fieldFacets = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-translate labels/aria-labels on switch
    const activeFields = this.active().fields;
    const ownedFields = this.queryOwned().fields ?? {};
    return this.facetCounts()
      .fields.map((field) => {
        const selection = activeFields[field.key] ?? {};
        const selected = selection.values ?? [];
        const vetoed = selection.excluded ?? [];
        const numeric = field.dataType.kind === 'number';
        const range = numeric || field.dataType.kind === 'date';
        // A dimension's labelKey translates; a scalar Field's label is authored, with no key (ADR-0055).
        const label = field.labelKey ? this.transloco.translate(field.labelKey) : field.label;
        const rows = withSelection(field.values, selected, vetoed).map((v) => ({
          value: v.value,
          count: v.count,
          label: this.valueLabel(field.valuesKeyPrefix, v),
          active: selected.includes(v.value),
          excluded: vetoed.includes(v.value),
          queryOwned: (ownedFields[field.key] ?? []).includes(v.value),
        }));
        return {
          key: field.key,
          label,
          kind: range ? ('range' as const) : ('values' as const),
          // A date range wants a date picker; every other range is numeric.
          inputType: field.dataType.kind === 'date' ? 'date' : 'number',
          minLabel: this.transloco.translate('entityBrowser.facets.rangeMin', {
            field: label,
          }),
          maxLabel: this.transloco.translate('entityBrowser.facets.rangeMax', {
            field: label,
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
 * One facet's server counts with the caller's choice merged in, **either polarity** (ADR-0081), so a
 * chosen value is always listed whatever its count — the server hides zero-count values, and a choice
 * it hid is still filtering the list, which for an exclusion would be a one-way door. A merged row
 * carries no server-sent `label`, so a value that renders through one (a Container, an Entity-Link
 * Field) falls back to its raw id: a row you can click off beats a row that vanished.
 */
function withSelection(
  rows: readonly FacetCount[],
  selected: readonly string[],
  excluded: readonly string[] = [],
): readonly FacetCount[] {
  const listed = new Set(rows.map((r) => r.value));
  // The Set dedupes a value a hand-edited URL named in both polarities — a contradiction the rail
  // makes unreachable, but one it must still render as a single row.
  const missing = [...new Set([...selected, ...excluded])]
    .filter((v) => !listed.has(v))
    .map((value) => ({ value, count: 0 }));
  return missing.length ? [...rows, ...missing] : rows;
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
