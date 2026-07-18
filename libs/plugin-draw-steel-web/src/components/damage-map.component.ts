import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SelectComponent } from '@hexly/web-ui';

/**
 * One immunities/weaknesses map of the {@link StatBlockViewComponent} — a per-damage-type number
 * (`{ poison: 2 }`). A reader gets the compact stat-block line ("Poison 2, Fire 3", or an em dash); a
 * writer gets a chip per present type (a value input + a remove ×) plus an "add type" dropdown listing the
 * damage types not yet set — the card's compact editor, never the nine fixed rows the spine first shipped.
 *
 * The map is a lens over the one grouped block value, so this component holds no map state: it emits one
 * `(type, value)` change and the View writes it back. Its only local state is the set of types the writer
 * has *added but not yet valued* — transient rows that must show an empty input without minting a `{}` entry
 * in the frontmatter until a number is typed.
 */
@Component({
  selector: 'ds-damage-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, SelectComponent],
  template: `
    @if (writable()) {
      <div class="flex flex-wrap items-center gap-2">
        @for (type of rows(); track type) {
          <span
            class="inline-flex items-center gap-1 rounded border border-line bg-surface-sunken px-2 py-0.5 text-sm"
            [attr.data-testid]="'damage-' + mapKey() + '-' + type"
          >
            <span class="text-ink-muted">{{ 'drawSteel.statBlock.damage.' + type | transloco }}</span>
            <input
              type="number"
              class="w-12 rounded border border-line bg-surface px-1 text-sm"
              [value]="valueOf(type)"
              (input)="emit(type, $event)"
            />
            <button
              type="button"
              class="text-ink-faint hover:text-danger"
              [attr.data-testid]="'damage-' + mapKey() + '-' + type + '-remove'"
              (click)="remove(type)"
            >
              ✕
            </button>
          </span>
        }
        @if (addable().length) {
          <select
            appSelect
            class="py-1 text-xs"
            [attr.data-testid]="'damage-' + mapKey() + '-add'"
            (change)="add($event)"
          >
            <option value="">{{ 'drawSteel.statBlock.addDamageType' | transloco }}</option>
            @for (type of addable(); track type) {
              <option [value]="type">{{ 'drawSteel.statBlock.damage.' + type | transloco }}</option>
            }
          </select>
        }
      </div>
    } @else {
      @if (present().length) {
        @for (type of present(); track type; let first = $first) {
          <span [attr.data-testid]="'damage-' + mapKey() + '-' + type"
            >{{ first ? '' : ', ' }}{{ 'drawSteel.statBlock.damage.' + type | transloco }} {{ valueOf(type) }}</span
          >
        }
      } @else {
        —
      }
    }
  `,
})
export class DamageMapComponent {
  /** The map key this section writes into (`immunities`/`weaknesses`), only for stable `data-testid`s. */
  readonly mapKey = input.required<string>();
  /** The raw per-damage-type value straight off the block — a lens, coerced to a number map to read. */
  readonly value = input<unknown>();
  readonly writable = input(false);
  /** The damage types this map may carry, in stat-block order — the closed vocabulary the dropdown offers. */
  readonly options = input<readonly string[]>([]);
  readonly valueChange = output<{ readonly type: string; readonly value: number | undefined }>();

  /** Types the writer has added but not yet valued — transient rows, so an empty input shows no husk in the map. */
  private readonly added = signal<ReadonlySet<string>>(new Set());

  /** The damage types the value carries, in the map's canonical order — what a reader sees. */
  protected readonly present = computed(() => this.options().filter((type) => this.valueOf(type) !== ''));

  /** The rows a writer edits: every present type plus any added-not-yet-valued one, in canonical order. */
  protected readonly rows = computed(() => {
    const added = this.added();
    return this.options().filter((type) => added.has(type) || this.valueOf(type) !== '');
  });

  /** The types still offerable in the add dropdown — the vocabulary minus the rows already shown. */
  protected readonly addable = computed(() => {
    const rows = new Set(this.rows());
    return this.options().filter((type) => !rows.has(type));
  });

  /** A type's stored number as an input string, or '' when absent/ill-typed (forward-only tolerance). */
  protected valueOf(type: string): string {
    const raw = asMap(this.value())[type];
    return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
  }

  /** Reveal an empty row for the picked type; the value writes only once a number is typed into it. */
  protected add(event: Event): void {
    const type = (event.target as HTMLSelectElement).value;
    if (!type) return;
    this.added.update((set) => new Set(set).add(type));
    (event.target as HTMLSelectElement).value = '';
  }

  /** Drop a type from both the transient rows and the stored map. */
  protected remove(type: string): void {
    this.added.update((set) => {
      const next = new Set(set);
      next.delete(type);
      return next;
    });
    this.valueChange.emit({ type, value: undefined });
  }

  /** Write a type's value; an emptied input clears it (the View drops the key, and an empty map with it). */
  protected emit(type: string, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.valueChange.emit({ type, value: raw === '' ? undefined : Number(raw) });
  }
}

/** A map value coerced to a bare record; a non-object (absent, scalar, array) reads as empty. */
function asMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
