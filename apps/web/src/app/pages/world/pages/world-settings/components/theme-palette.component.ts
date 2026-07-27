import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColorScheme } from '@hexly/web-core';
import { WorldThemePalette } from '@hexly/domain';
import { COLOR_SCHEMES, PALETTE_CONTROLS, PaletteControl, controlValue } from '../utils/theme-draft';
import { ThemeControlComponent } from './theme-control.component';

/** One control moved: which ColorScheme's Palette, which tier-1 token, and what the control emitted. */
export interface PaletteEdit {
  readonly scheme: ColorScheme;
  readonly control: PaletteControl;
  readonly raw: string;
}

/**
 * The Palette an Owner authors: a row per tier-1 token, a column per ColorScheme (ADR-0075, #371).
 *
 * Both halves side by side rather than behind a switch, because a Theme and a reader's ColorScheme are
 * orthogonal (ADR-0006) — an Owner who can only reach the scheme they are sitting in ships half a
 * Theme, and one who has to toggle their *own* scheme to reach the other half is being asked to change
 * a reading preference to do an authoring job.
 *
 * The rows are the manifest's tier-1 slice, so a newly declared anchor or knob appears here on its own.
 */
@Component({
  selector: 'app-theme-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ThemeControlComponent],
  template: `
    <div class="grid">
      <span class="corner" aria-hidden="true"></span>
      @for (scheme of schemes; track scheme) {
        <!-- #373's contrast report for this ColorScheme attaches inside this head. -->
        <div class="scheme-head" [attr.data-testid]="'theme-scheme-' + scheme">
          {{ 'common.colorScheme.' + scheme | transloco }}
        </div>
      }

      @for (control of controls; track control.token) {
        <div class="row-label">
          <span class="row-name">{{ 'worldTheme.token.' + control.field | transloco }}</span>
          <span class="row-hint">{{ 'worldTheme.hint.' + control.field | transloco }}</span>
        </div>
        @for (scheme of schemes; track scheme) {
          <app-theme-control
            [control]="control"
            [value]="valueOf(scheme, control)"
            [label]="
              ('worldTheme.token.' + control.field | transloco) + ' — ' + ('common.colorScheme.' + scheme | transloco)
            "
            [testid]="'theme-control-' + scheme + '-' + control.field"
            (changed)="changed.emit({ scheme, control, raw: $event })"
          />
        }
      }
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .grid {
      @apply grid items-center gap-x-4 gap-y-2;
      grid-template-columns: minmax(9rem, 1fr) minmax(8rem, 1fr) minmax(8rem, 1fr);
    }
    .scheme-head {
      @apply pb-1 font-display text-sm text-ink-strong;
    }
    .row-label {
      @apply flex flex-col;
    }
    .row-name {
      @apply text-sm text-ink-strong;
    }
    .row-hint {
      @apply text-2xs text-ink-faint;
    }
  `,
})
export class ThemePaletteComponent {
  /** What each ColorScheme's controls show — the draft where there is one, the Hexly default where not. */
  readonly palettes = input.required<Readonly<Record<ColorScheme, WorldThemePalette>>>();

  readonly changed = output<PaletteEdit>();

  protected readonly controls = PALETTE_CONTROLS;
  protected readonly schemes = COLOR_SCHEMES;

  protected valueOf(scheme: ColorScheme, control: PaletteControl): string {
    return controlValue(this.palettes()[scheme], control);
  }
}
