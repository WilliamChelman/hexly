import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Field } from '@hexly/domain';
import { FieldControlComponent } from '@hexly/web-entity';

/**
 * One value slot of the {@link StatBlockViewComponent}: the Field's live value, printed as text for a
 * reader and offered as a {@link FieldControlComponent} to a writer. A reader gets printed text, never a
 * disabled control.
 */
@Component({
  selector: 'ds-stat-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [FieldControlComponent],
  template: `
    @if (writable()) {
      <app-field-control
        [field]="field()"
        [value]="value()"
        [invalid]="invalid()"
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
  readonly valueChange = output<unknown>();

  /** An unfilled stat prints as an em dash; a list (movement, keywords) joins on `, ` for legibility. */
  protected printed(): string {
    const value = this.value();
    if (value === undefined || value === null || value === '') return '—';
    if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
    return String(value);
  }
}
