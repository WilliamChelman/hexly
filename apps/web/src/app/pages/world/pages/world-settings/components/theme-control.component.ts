import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { InputComponent } from '@hexly/web-ui';
import { TokenControl } from '../utils/theme-draft';

/**
 * One design-token control, chosen by the token's **declared type** (ADR-0075) and never by its name:
 * the manifest is what says a token holds a colour or a number, and the editor asking it is what makes
 * a newly declared token authorable without a change here.
 *
 * Type-driven and tier-agnostic on purpose — the same component serves the tier-1 anchors and knobs
 * (#371), a tier-2 override (#374), and a radius (#375). A type with no control of its own falls back
 * to a plain text field, which is the honest offer for a value the editor has no better shape for.
 *
 * Emits on `input` rather than `change`, because the point of the editor is that the interface
 * re-themes while the control is still being dragged.
 */
@Component({
  selector: 'app-theme-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InputComponent],
  template: `
    @switch (control().type) {
      @case ('color') {
        <span class="colour">
          <input
            type="color"
            class="colour-well"
            [attr.aria-label]="label()"
            [attr.data-testid]="testid()"
            [value]="value()"
            (input)="emit($event)"
          />
          <span class="readout">{{ value() }}</span>
        </span>
      }
      @case ('number') {
        <span class="knob">
          <input
            type="range"
            class="knob-slider"
            [attr.aria-label]="label()"
            [attr.data-testid]="testid()"
            [min]="range().min"
            [max]="range().max"
            [step]="range().step"
            [value]="value()"
            (input)="emit($event)"
          />
          <span class="readout" [attr.data-testid]="testid() + '-value'">{{ value() }}</span>
        </span>
      }
      @default {
        <input
          appInput
          type="text"
          [attr.aria-label]="label()"
          [attr.data-testid]="testid()"
          [value]="value()"
          (input)="emit($event)"
        />
      }
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .colour,
    .knob {
      @apply flex items-center gap-2;
    }
    .colour-well {
      @apply h-8 w-10 flex-none cursor-pointer rounded-md border border-line-strong bg-surface-sunken p-0.5 shadow-inset;
    }
    .knob-slider {
      @apply min-w-0 flex-1 cursor-pointer accent-accent;
    }
    .readout {
      @apply font-mono text-2xs tabular-nums text-ink-muted;
    }
  `,
})
export class ThemeControlComponent {
  /** Which token is being authored, and of what type — the manifest's own declaration (ADR-0075). */
  readonly control = input.required<TokenControl>();
  /** The control's accessible name; there is one control per ColorScheme, so it names that too. */
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly testid = input.required<string>();

  readonly changed = output<string>();

  /** A number with no declared domain still gets a slider, over the unit interval the knobs live in. */
  protected readonly range = computed(() => this.control().range ?? { min: 0, max: 1, step: 0.01 });

  protected emit(event: Event): void {
    this.changed.emit((event.target as HTMLInputElement).value);
  }
}
