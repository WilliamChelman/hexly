import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { InputComponent, SelectComponent } from '@hexly/web-ui';
import { activeLangLabel, matchesSearchAndSource } from '../utils/picker-support';
import { DataTypeChoice } from '../utils/datatype-choices';

/**
 * The Data-Type picker: a keyboard-navigable card grid, searchable by label/kind and scoped to a
 * source plugin, replacing the datatype `<select>` in the World Fields editor and the World Types
 * editor's inline new-Field form (#191, #230). Every type is visible at once and a plugin's
 * Structured Data Type reads as first-class rather than hiding at the bottom of a menu. The picked
 * `kind` is a two-way model; enum options (and any per-kind extras) stay with the host form.
 */
@Component({
  selector: 'app-datatype-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dp-controls">
      <span class="dp-search">
        <input
          appInput
          type="search"
          [attr.data-testid]="testid() + '-search'"
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

    <div class="dp-grid" role="radiogroup" [attr.aria-label]="searchPlaceholder()">
      @for (o of visible(); track o.kind) {
        <button
          type="button"
          role="radio"
          class="dp-cell"
          [class.is-on]="kind() === o.kind"
          [attr.aria-checked]="kind() === o.kind"
          [attr.data-testid]="testid() + '-option-' + o.kind"
          (click)="kind.set(o.kind)"
        >
          <span class="dp-glyph">{{ o.glyph }}</span>
          <span class="dp-label">{{ o.label }}</span>
          @if (showSource()) {
            <span class="dp-tag">{{ o.source }}</span>
          }
        </button>
      } @empty {
        <p class="dp-empty">{{ 'picker.noMatch' | transloco }}</p>
      }
    </div>
  `,
  imports: [TranslocoPipe, InputComponent, SelectComponent, FormField],
  styles: `
    @reference '#app-styles.css';
    .dp-controls {
      @apply mb-3 flex gap-2;
    }
    .dp-search {
      @apply min-w-0 flex-1;
    }
    .dp-grid {
      @apply grid gap-2;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    }
    .dp-cell {
      @apply relative flex items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors;
    }
    .dp-cell:hover {
      @apply border-line-strong;
    }
    .dp-cell.is-on {
      @apply border-accent bg-accent-soft ring-1 ring-accent/40;
    }
    .dp-glyph {
      @apply grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken font-mono text-sm text-ink-strong;
    }
    .dp-cell.is-on .dp-glyph {
      @apply bg-accent/15 text-accent;
    }
    .dp-label {
      @apply text-sm font-medium text-ink-strong;
    }
    .dp-tag {
      @apply absolute right-2 top-2 rounded-full bg-surface-sunken px-1.5 text-[0.6rem] uppercase tracking-wide text-ink-muted;
    }
    .dp-empty {
      @apply text-sm text-ink-muted;
    }
  `,
})
export class DatatypePickerComponent {
  private readonly transloco = inject(TranslocoService);

  readonly options = input.required<readonly DataTypeChoice[]>();
  /** The picked data-type kind — two-way, so the host form reads and reseeds it. */
  readonly kind = model.required<string>();
  /** A prefix for the option `data-testid`s, so two pickers on one form stay addressable. */
  readonly testid = input('datatype');

  /** Search text + active source filter (`''` source means all), bound to the controls as a signal form. */
  protected readonly filterModel = signal({ query: '', source: '' });
  protected readonly filters = form(this.filterModel);

  protected readonly allSources = computed(() => activeLangLabel(this.transloco, 'picker.allSources'));
  protected readonly searchPlaceholder = computed(() => activeLangLabel(this.transloco, 'picker.searchTypes'));

  protected readonly sources = computed(() => [...new Set(this.options().map((o) => o.source))]);
  /** A lone source is no filter — only offer the select when the picker spans more than one. */
  protected readonly showSource = computed(() => this.sources().length > 1);

  protected readonly visible = computed(() => {
    const filter = this.filterModel();
    return this.options().filter((o) => matchesSearchAndSource(o, filter, (c) => [c.label, c.kind]));
  });
}
