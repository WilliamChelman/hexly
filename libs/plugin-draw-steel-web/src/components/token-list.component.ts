import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ChipComponent, InputComponent, SelectComponent } from '@hexly/web-ui';

/**
 * A tags-like editor over a `string[]` Field, built from the design-system atoms (chip / input / select).
 * Two shapes off one input: pass `options` and it is a **constrained** multi-select (movement types — an
 * add dropdown of the unchosen values); omit them and it is a **free** tag input (keywords — a text box
 * that adds the typed token on Enter). Either way each token is a removable chip.
 *
 * A lens, like the rest of the card: it holds no list, it emits the next `string[]` and the View writes it
 * back to the one block value (an empty array clears the key).
 */
@Component({
  selector: 'ds-token-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, ChipComponent, InputComponent, SelectComponent],
  template: `
    <div class="flex flex-wrap items-center gap-1.5">
      @for (token of tokens(); track token) {
        <app-chip>
          {{ token }}
          <button
            type="button"
            class="text-ink-faint hover:text-danger"
            [attr.aria-label]="('drawSteel.statBlock.remove' | transloco) + ' ' + token"
            (click)="remove(token)"
          >
            ✕
          </button>
        </app-chip>
      }

      @if (options(); as opts) {
        @if (addable().length) {
          <select appSelect class="py-1 text-xs" [attr.aria-invalid]="invalid() || null" (change)="add($event)">
            <option value="">{{ placeholderKey() | transloco }}</option>
            @for (opt of addable(); track opt) {
              <option [value]="opt">{{ opt }}</option>
            }
          </select>
        }
      } @else {
        <input
          appInput
          class="w-36 py-1 text-xs"
          [attr.aria-invalid]="invalid() || null"
          [placeholder]="placeholderKey() | transloco"
          (keydown.enter)="addTyped($event)"
        />
      }
    </div>
  `,
})
export class TokenListComponent {
  /** The raw list value off the block — coerced to a string array, ill-typed items dropped (forward-only). */
  readonly value = input<unknown>();
  /** The closed vocabulary, for a constrained multi-select; omit for a free-text tag input. */
  readonly options = input<readonly string[] | undefined>(undefined);
  /** The transloco key for the add control's placeholder ("Add movement…", "Add keyword…"). */
  readonly placeholderKey = input('');
  readonly invalid = input(false);
  readonly valueChange = output<string[]>();

  /** The chosen tokens, in stored order. */
  protected readonly tokens = computed(() => asStringArray(this.value()));

  /** The options not yet chosen — what the add dropdown offers (constrained mode only). */
  protected readonly addable = computed(() => {
    const chosen = new Set(this.tokens());
    return (this.options() ?? []).filter((option) => !chosen.has(option));
  });

  /** Append a picked option, then reset the dropdown to its placeholder. */
  protected add(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (!select.value) return;
    this.valueChange.emit([...this.tokens(), select.value]);
    select.value = '';
  }

  /** Append a typed token on Enter — trimmed, de-duplicated; the box clears either way. */
  protected addTyped(event: Event): void {
    event.preventDefault();
    const inputEl = event.target as HTMLInputElement;
    const token = inputEl.value.trim();
    inputEl.value = '';
    if (token && !this.tokens().includes(token)) this.valueChange.emit([...this.tokens(), token]);
  }

  /** Drop a token; emitting `[]` for the last one lets the View clear the key. */
  protected remove(token: string): void {
    this.valueChange.emit(this.tokens().filter((chosen) => chosen !== token));
  }
}

/** A list value coerced to a string array — a non-array, or a non-string item, is dropped, never thrown on. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
