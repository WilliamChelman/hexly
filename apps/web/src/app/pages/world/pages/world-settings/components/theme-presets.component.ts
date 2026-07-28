import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CardRadioComponent, CardRadioGroupComponent } from '@hexly/web-ui';
import { PalettePreset, WorldThemePalette } from '@hexly/domain';
import { ColorScheme } from '@hexly/web-core';
import { PALETTE_PRESET_CHOICES, palettePresetOf } from '../utils/theme-draft';

/**
 * One ColorScheme's ready-made Palettes (#384), heading the column above the eleven controls a pick
 * seeds — the pick and its consequence in one visual unit (ADR-0077).
 *
 * Each option is a **specimen of its own anchors**, so an Owner chooses by looking; the offer is the
 * domain's table, so a Preset added there appears here with no edit.
 *
 * The mark is derived from the Palette on screen ({@link palettePresetOf}) and not from a stored id,
 * which is what clears it the moment an anchor moves.
 */
@Component({
  selector: 'app-theme-presets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, CardRadioComponent, CardRadioGroupComponent],
  template: `
    <!-- Named by its own ColorScheme: two groups reading "Preset" would be one control to a reader
         who cannot see which column they are in, and the two are picked independently. -->
    <div
      appCardRadioGroup
      [attr.aria-label]="
        ('worldTheme.palettePresetsLabel' | transloco) + ' — ' + ('common.colorScheme.' + scheme() | transloco)
      "
    >
      @for (preset of presets(); track preset.id) {
        <app-card-radio
          basis="100%"
          [name]="'theme-preset-' + scheme()"
          [testId]="'theme-preset-' + scheme() + '-' + preset.id"
          [checked]="preset.id === selected()"
          [label]="'worldTheme.palettePresets.' + preset.id | transloco"
          [hint]="'worldTheme.palettePresetsHint.' + preset.id | transloco"
          (picked)="picked.emit(preset)"
        >
          <!-- A miniature of the page it makes: the paper, the map field on it, two inks and the
               accent. Anchors, not derived roles — a specimen of the values the pick actually writes. -->
          <span cardLead class="swatch" aria-hidden="true" [style.background]="preset.values.page">
            <span class="field" [style.background]="preset.values.canvas"></span>
            <span class="rule ink" [style.background]="preset.values.ink"></span>
            <span class="rule quiet" [style.background]="preset.values.inkQuiet"></span>
            <span class="dot" [style.background]="preset.values.accent"></span>
          </span>
        </app-card-radio>
      }
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .swatch {
      @apply relative h-10 w-10 flex-none overflow-hidden rounded-md border border-line-strong;
    }
    .field {
      @apply absolute inset-x-0 bottom-0 h-2/5;
    }
    .rule {
      @apply absolute left-1.5 h-0.5 rounded-full;
    }
    .ink {
      @apply top-1.5 w-6;
    }
    .quiet {
      @apply top-3 w-4;
    }
    .dot {
      @apply absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full;
    }
  `,
})
export class ThemePresetsComponent {
  readonly scheme = input.required<ColorScheme>();

  /** The Palette this column currently shows — what the mark is derived from, never a stored id. */
  readonly palette = input.required<WorldThemePalette>();

  readonly picked = output<PalettePreset>();

  protected readonly presets = computed(() => PALETTE_PRESET_CHOICES[this.scheme()]);
  protected readonly selected = computed(() => palettePresetOf(this.palette(), this.scheme()));
}
