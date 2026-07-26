import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ChipComponent, InputComponent, SelectComponent } from '@hexly/web-ui';
import { activeLangLabel, matchesSearchAndSource } from '../utils/picker-support';

/** One Field the picker offers: its `id`, display `label`, its data-type `typeLabel`, and its `source`. */
export interface FieldChoice {
  id: string;
  label: string;
  typeLabel: string;
  source: string;
}

/**
 * The Field-reference picker: a searchable, source-scoped multi-select over the World's registered
 * Fields (ADR-0054), replacing the flat checkbox wall in the World Types editor. Selected Fields ride
 * up top as removable chips, a search box narrows by label/id, and a source-plugin select scopes big
 * libraries — the checkbox list didn't scale past a handful. Selection is owned by the host
 * (`selected` in, one `toggled` id out); no order is implied here beyond the host's `selected` array.
 */
@Component({
  selector: 'app-field-ref-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ChipComponent, InputComponent, SelectComponent, FormField],
  template: `
    <div class="fp-chips">
      @for (f of selectedFields(); track f.id) {
        <button type="button" class="fp-chip" [attr.aria-label]="'✕ ' + f.label" (click)="toggled.emit(f.id)">
          <app-chip tone="accent">{{ f.label }} <span aria-hidden="true">✕</span></app-chip>
        </button>
      } @empty {
        <span class="fp-chips-empty">{{ 'picker.selectedEmpty' | transloco }}</span>
      }
    </div>

    <div class="fp-controls">
      <span class="fp-search">
        <input
          appInput
          type="search"
          data-testid="field-ref-search"
          [placeholder]="searchPlaceholder()"
          [formField]="filters.query"
        />
      </span>
      @if (showSource()) {
        <select appSelect [attr.aria-label]="allSources()" [formField]="filters.source">
          <option value="">{{ allSources() }}</option>
          @for (s of sources(); track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
      }
    </div>

    <ul class="fp-list">
      @for (f of visible(); track f.id) {
        <li [attr.data-testid]="'field-ref-' + f.id">
          <button
            type="button"
            role="checkbox"
            class="fp-opt"
            [class.is-on]="isSelected(f.id)"
            [attr.aria-checked]="isSelected(f.id)"
            [attr.data-testid]="'field-ref-checkbox-' + f.id"
            (click)="toggled.emit(f.id)"
          >
            <span class="fp-box">{{ isSelected(f.id) ? '✓' : '' }}</span>
            <span class="fp-name">{{ f.label }}</span>
            <span class="fp-id">{{ f.id }} · {{ f.typeLabel }}</span>
          </button>
        </li>
      } @empty {
        <li class="fp-empty" data-testid="no-fields-available">
          @if (fields().length) {
            {{ 'picker.noMatch' | transloco }}
          } @else {
            {{ 'worldTypes.noFieldsAvailable' | transloco }}
          }
        </li>
      }
    </ul>
  `,
  styles: `
    @reference '#app-styles.css';
    .fp-chips {
      @apply mb-2 flex flex-wrap gap-1.5;
    }
    .fp-chip {
      @apply cursor-pointer;
    }
    .fp-chip:hover {
      @apply opacity-80;
    }
    .fp-chips-empty {
      @apply text-2xs italic text-ink-muted;
    }
    .fp-controls {
      @apply mb-2 flex gap-2;
    }
    .fp-search {
      @apply min-w-0 flex-1;
    }
    .fp-list {
      @apply flex max-h-72 flex-col gap-0.5 overflow-y-auto;
    }
    .fp-opt {
      @apply flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left;
    }
    .fp-opt:hover {
      @apply bg-surface-sunken;
    }
    .fp-opt.is-on {
      @apply bg-accent-soft/60;
    }
    .fp-box {
      @apply grid size-4 shrink-0 place-items-center rounded-sm border border-line-strong text-2xs text-accent;
    }
    .fp-opt.is-on .fp-box {
      @apply border-accent bg-accent/15;
    }
    .fp-name {
      @apply text-sm text-ink-strong;
    }
    .fp-id {
      @apply flex-1 truncate font-mono text-2xs text-ink-muted;
    }
    .fp-empty {
      @apply px-1 py-2 text-sm text-ink-muted;
    }
  `,
})
export class FieldRefPickerComponent {
  private readonly transloco = inject(TranslocoService);

  readonly fields = input.required<readonly FieldChoice[]>();
  /** The referenced Field ids (`fieldRefs`) the host owns; the picker reads, never mutates. */
  readonly selected = input.required<readonly string[]>();
  /** A Field id whose membership should flip — the host applies it (keeps reference order, ADR-0054). */
  readonly toggled = output<string>();

  /** Search text + active source filter (`''` source means all), bound to the controls as a signal form. */
  protected readonly filterModel = signal({ query: '', source: '' });
  protected readonly filters = form(this.filterModel);

  protected readonly allSources = computed(() => activeLangLabel(this.transloco, 'picker.allSources'));
  protected readonly searchPlaceholder = computed(() => activeLangLabel(this.transloco, 'picker.searchFields'));

  protected readonly sources = computed(() => [...new Set(this.fields().map((f) => f.source))]);
  protected readonly showSource = computed(() => this.sources().length > 1);

  protected readonly visible = computed(() => {
    const filter = this.filterModel();
    return this.fields().filter((f) => matchesSearchAndSource(f, filter, (c) => [c.label, c.id]));
  });

  /** The selected Fields in the host's reference order, for the chip row. */
  protected readonly selectedFields = computed(() => {
    const byId = new Map(this.fields().map((f) => [f.id, f]));
    return this.selected()
      .map((id) => byId.get(id))
      .filter((f): f is FieldChoice => !!f);
  });

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }
}
