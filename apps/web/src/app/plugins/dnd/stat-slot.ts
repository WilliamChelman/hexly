import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FieldSchema } from '@hexly/domain';
import { FieldControl } from '../../pages/entity/views/field-control';

/**
 * One value slot of the {@link StatBlockView}: the Field's live value, printed as text for a reader
 * and offered as a {@link FieldControl} to a writer. Extracted because the stat block has three
 * groups of them (identity, defences, abilities, and the Challenge Rating) and inlining the branch
 * per group let one of them drift out of sync.
 *
 * The reader's branch is not a disabled control but printed text — a stat block is a thing a player
 * *reads*, and rendering it as greyed-out inputs would be the raw-Metadata look the bespoke view
 * exists to replace (#192).
 */
@Component({
  selector: 'app-stat-slot',
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
  /** The Field's raw value straight off the Metadata map — the lens, never a copy. */
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
