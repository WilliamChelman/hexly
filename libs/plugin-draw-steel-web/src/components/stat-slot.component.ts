import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Field } from '@hexly/domain';
import { StatControlComponent } from './stat-control.component';

/**
 * One value slot of the {@link StatBlockViewComponent}: the Field's live value, printed as text for a
 * reader and offered as a {@link StatControlComponent} (a design-system control) to a writer. A reader
 * gets printed text, never a disabled control.
 */
@Component({
  selector: 'ds-stat-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [StatControlComponent],
  template: `
    @if (writable()) {
      <ds-stat-control
        [field]="field()"
        [value]="value()"
        [invalid]="invalid()"
        [compact]="compact()"
        [placeholderKey]="placeholderKey()"
        (valueChange)="valueChange.emit($event)"
      />
    } @else {
      {{ printed() }}
    }
  `,
})
export class StatSlotComponent {
  readonly field = input.required<Field>();
  /** The Field's raw value straight off the EntityDocument map — the lens, never a copy. */
  readonly value = input<unknown>();
  readonly writable = input(false);
  readonly invalid = input(false);
  /** Render the writable control as the tighter, spinner-less `appInput` — for a cramped grid cell. */
  readonly compact = input(false);
  /** Print a positive number with a leading `+` — the Draw Steel characteristic convention (`+2`, `0`, `-1`). */
  readonly signed = input(false);
  /** Forwarded to a `list` control for its add-placeholder key (movement, keywords). */
  readonly placeholderKey = input('');
  readonly valueChange = output<unknown>();

  /** An unfilled stat prints as an em dash; a list (movement, keywords) joins on `, ` for legibility. */
  protected printed(): string {
    const value = this.value();
    if (value === undefined || value === null || value === '') return '—';
    if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
    if (this.signed() && typeof value === 'number' && value > 0) return `+${value}`;
    return String(value);
  }
}
