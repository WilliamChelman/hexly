import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FieldSchema } from '@hexly/domain';

/**
 * One data-type-appropriate control for a typed Field (ADR-0048), shared by {@link GenericFieldView}
 * and the add-type prompt (#189). Presentational: reads a raw Metadata `value`, emits the edited one
 * coerced to the Field's data-type (a `list` splits on commas, a `number` empties to `undefined`).
 */
@Component({
  selector: 'app-field-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @switch (field().dataType.kind) {
      @case ('boolean') {
        <input
          type="checkbox"
          [checked]="value() === true"
          [disabled]="disabled()"
          (change)="valueChange.emit(checkboxChecked($event))"
        />
      }
      @case ('enum') {
        <select
          class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (change)="valueChange.emit(selectValue($event))"
        >
          <option value=""></option>
          @for (option of options(); track option) {
            <option [value]="option" [selected]="option === stringValue()">
              {{ option }}
            </option>
          }
        </select>
      }
      @case ('date') {
        <input
          type="date"
          class="rounded border border-line bg-surface px-2 py-1 text-sm"
          [value]="stringValue()"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (change)="valueChange.emit(inputValue($event))"
        />
      }
      @case ('number') {
        <input
          type="number"
          class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          [value]="stringValue()"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (input)="valueChange.emit(numberValue($event))"
        />
      }
      @default {
        <!-- string, and list<scalar> as a comma-separated text field. -->
        <input
          type="text"
          class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          [value]="stringValue()"
          [disabled]="disabled()"
          [attr.aria-invalid]="invalid() || null"
          (input)="valueChange.emit(typedValue(inputValue($event)))"
        />
      }
    }
  `,
})
export class FieldControl {
  readonly field = input.required<FieldSchema>();
  /** The Field's current raw Metadata value (a lens, never copied — CONTEXT.md → Field). */
  readonly value = input<unknown>();
  readonly disabled = input(false);
  /** Flags the control invalid (forward-only validation), driving `aria-invalid`. */
  readonly invalid = input(false);
  readonly valueChange = output<unknown>();

  /** The options of an `enum` Field, for its `<select>`; empty for any other data-type. */
  protected options(): readonly string[] {
    const dataType = this.field().dataType;
    return dataType.kind === 'enum' ? dataType.options : [];
  }

  /** The Field's value rendered as an input string — a list joins on `, `, a scalar stringifies. */
  protected stringValue(): string {
    const value = this.value();
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  /** Coerce a text input to the Field's data-type: a `list` splits on commas, a scalar passes through. */
  protected typedValue(raw: string): unknown {
    const dataType = this.field().dataType;
    if (dataType.kind !== 'list') return raw;
    const itemKind = dataType.of.kind;
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => (itemKind === 'number' ? Number(part) : part));
  }

  /** An empty number input clears the Field; otherwise it becomes a real `number`. */
  protected numberValue(event: Event): number | undefined {
    const raw = this.inputValue(event);
    return raw === '' ? undefined : Number(raw);
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected checkboxChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
