import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Field } from '@hexly/domain';
import { InputComponent, SelectComponent } from '@hexly/web-ui';
import { TokenListComponent } from './token-list.component';

/**
 * The stat block's edit control for one Field, built from the design-system atoms rather than the generic
 * `app-field-control`: a styled `<select appSelect>` for an enum, `<input appInput>` for a number or a
 * string, and a {@link TokenListComponent} for a list (a movement multi-select, a keywords tag box). It
 * reads the raw block value and emits the edited one coerced to the Field's data-type — the same lens
 * contract the rest of the card writes through.
 */
@Component({
  selector: 'ds-stat-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, InputComponent, SelectComponent, TokenListComponent],
  template: `
    @switch (field().dataType.kind) {
      @case ('enum') {
        <!-- Auto-width (max-w-full), never w-full: the box hugs its content so the chevron — a right-pinned
             background on appSelect — always sits in the reserved padding after the text, never over it. -->
        <select
          appSelect
          class="max-w-full"
          [attr.aria-invalid]="invalid() || null"
          (change)="valueChange.emit(selectValue($event))"
        >
          <!-- Placeholder: hidden from the list (so no checkmarked "selected" row) and shown as the closed
               display only while unset, carrying the Field's label. -->
          <option value="" hidden [selected]="!stringValue()">{{ placeholder() | transloco }}</option>
          @for (option of enumOptions(); track option) {
            <option [value]="option" [selected]="option === stringValue()">{{ option }}</option>
          }
        </select>
      }
      @case ('number') {
        <input
          appInput
          type="number"
          [attr.compact]="compact() ? '' : null"
          [value]="stringValue()"
          [attr.aria-invalid]="invalid() || null"
          (input)="valueChange.emit(numberValue($event))"
        />
      }
      @case ('list') {
        <ds-token-list
          [value]="value()"
          [options]="listOptions()"
          [placeholderKey]="placeholderKey()"
          [invalid]="invalid()"
          (valueChange)="valueChange.emit($event)"
        />
      }
      @default {
        <input
          appInput
          type="text"
          [value]="stringValue()"
          [attr.aria-invalid]="invalid() || null"
          (input)="valueChange.emit(inputValue($event))"
        />
      }
    }
  `,
})
export class StatControlComponent {
  readonly field = input.required<Field>();
  /** The Field's raw block value — a lens, never copied. */
  readonly value = input<unknown>();
  readonly invalid = input(false);
  /** Render the tighter, spinner-less `appInput` — for a single digit in a cramped grid cell (characteristics). */
  readonly compact = input(false);
  /** The transloco key a `list` Field's add control shows as its placeholder. */
  readonly placeholderKey = input('');
  readonly valueChange = output<unknown>();

  /** The empty option's label — the Field's own label, so an unset select shows what it is, not a blank. */
  protected readonly placeholder = computed(() => this.field().labelKey ?? this.field().label);

  /** An enum Field's options, for its `<select>`; empty for any other kind. */
  protected readonly enumOptions = computed<readonly string[]>(() => {
    const dataType = this.field().dataType;
    return dataType.kind === 'enum' ? dataType.options : [];
  });

  /** A `list<enum>` Field's item options — the constrained vocabulary the token list offers; else undefined. */
  protected readonly listOptions = computed<readonly string[] | undefined>(() => {
    const dataType = this.field().dataType;
    return dataType.kind === 'list' && dataType.of.kind === 'enum' ? dataType.of.options : undefined;
  });

  /** The value as an input/option string — a scalar stringifies, null reads blank. */
  protected stringValue(): string {
    const value = this.value();
    return value == null ? '' : String(value);
  }

  /** An empty number input clears the Field; otherwise it becomes a real `number`. */
  protected numberValue(event: Event): number | undefined {
    const raw = (event.target as HTMLInputElement).value;
    return raw === '' ? undefined : Number(raw);
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
