import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FieldSchema } from '@hexly/domain';
import { FieldControl } from '@hexly/web-entity/controls';

/**
 * One value slot of the {@link StatBlockView}: the Field's live value, printed as text for a reader
 * and offered as a {@link FieldControl} to a writer. A reader gets printed text, never a disabled
 * control.
 */
@Component({
  selector: 'dnd-stat-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [FieldControl],
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
export class StatSlot {
  readonly field = input.required<FieldSchema>();
  /** The Field's raw value straight off the EntityDocument map — the lens, never a copy. */
  readonly value = input<unknown>();
  readonly writable = input(false);
  readonly invalid = input(false);
  readonly valueChange = output<unknown>();

  /** An unfilled stat prints as an em dash rather than a blank cell, so the block stays legible. */
  protected printed(): string {
    const value = this.value();
    return value === undefined || value === null || value === '' ? '—' : String(value);
  }
}
