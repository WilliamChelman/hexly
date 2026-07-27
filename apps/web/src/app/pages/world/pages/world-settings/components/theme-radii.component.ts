import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { designTokenInitial } from '@hexly/web-styles';
import { WorldTheme } from '@hexly/domain';
import { RADIUS_PRESETS, RadiusPreset, radiusPresetOf } from '../utils/theme-draft';

/**
 * The corner-radius set an Owner picks (#375): sharp to soft, one decision rather than five lengths.
 *
 * Each set is shown as the shape it makes, in its own radius — the swatch is the specimen, so a set
 * added to {@link RADIUS_PRESETS} needs no illustration of its own. The whole interface repaints while
 * the picker is open anyway, since the draft previews through the applier.
 */
@Component({
  selector: 'app-theme-radii',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    <div class="sets" role="radiogroup" [attr.aria-label]="'worldTheme.radiiHeading' | transloco">
      @for (preset of presets; track preset.id) {
        <label class="set">
          <input
            type="radio"
            name="theme-radii"
            [attr.data-testid]="'theme-radii-' + preset.id"
            [checked]="preset.id === selected()"
            (change)="picked.emit(preset)"
          />
          <span class="swatch" aria-hidden="true" [style.borderRadius]="swatchRadius(preset)"></span>
          <span class="labels">
            <span class="name">{{ 'worldTheme.radii.' + preset.id | transloco }}</span>
            <span class="hint">{{ 'worldTheme.radiiHint.' + preset.id | transloco }}</span>
          </span>
        </label>
      }
    </div>
    @if (!selected()) {
      <!-- The schema takes any set of the five, so a Theme authored over the API may match no set. -->
      <p class="custom" data-testid="theme-radii-custom">{{ 'worldTheme.radiiCustom' | transloco }}</p>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .sets {
      @apply flex flex-wrap gap-3;
    }
    .set {
      @apply flex flex-1 basis-48 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2;
    }
    .set:has(input:checked) {
      @apply border-line-strong bg-surface-raised;
    }
    .swatch {
      @apply h-9 w-9 flex-none border border-line-strong bg-surface shadow-inset;
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
    .custom {
      @apply text-2xs text-ink-muted;
    }
  `,
})
export class ThemeRadiiComponent {
  /** The set the draft carries; absent for a World that stores none. */
  readonly radii = input.required<WorldTheme['radii']>();

  readonly picked = output<RadiusPreset>();

  protected readonly presets = RADIUS_PRESETS;
  protected readonly selected = computed(() => radiusPresetOf(this.radii()));

  /** What the swatch is rounded by: the set's own large radius, or the stylesheet's for the default. */
  protected swatchRadius(preset: RadiusPreset): string {
    return preset.radii?.['--radius-lg'] ?? designTokenInitial('--radius-lg');
  }
}
