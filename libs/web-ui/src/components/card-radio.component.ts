import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * One radio rendered as a card: the control, its name and hint, and a specimen of what it picks.
 *
 * Two projection slots because the specimen sits differently per picker and that is the only thing
 * that differs — `[cardLead]` rides the head row beside the control, `[cardBelow]` sits under it.
 */
@Component({
  selector: 'app-card-radio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="card" [style.flexBasis]="basis()">
      <span class="head">
        <input
          type="radio"
          [name]="name()"
          [attr.data-testid]="testId()"
          [checked]="checked()"
          (change)="picked.emit()"
        />
        <ng-content select="[cardLead]" />
        <span class="labels">
          <span class="name">{{ label() }}</span>
          <span class="hint">{{ hint() }}</span>
        </span>
      </span>
      <ng-content select="[cardBelow]" />
    </label>
  `,
  styles: `
    @reference '#app-styles.css';

    :host {
      @apply flex flex-1;
    }
    .card {
      @apply flex flex-1 cursor-pointer flex-col gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2;
    }
    .card:has(input:checked) {
      @apply border-line-strong bg-surface-raised;
    }
    .head {
      @apply flex items-center gap-3;
    }
    .labels {
      @apply flex min-w-0 flex-col;
    }
    .name {
      @apply text-sm text-ink-strong;
    }
    .hint {
      @apply text-2xs text-ink-faint;
    }
  `,
})
export class CardRadioComponent {
  /** Shared by every card in one group — what makes the native radios exclusive. */
  readonly name = input.required<string>();
  readonly testId = input.required<string>();
  readonly checked = input.required<boolean>();
  readonly label = input.required<string>();
  readonly hint = input.required<string>();
  /** How wide the card wants to be before wrapping; a specimen needs more room than a swatch. */
  readonly basis = input('12rem');

  readonly picked = output<void>();
}
