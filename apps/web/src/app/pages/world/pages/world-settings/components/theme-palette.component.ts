import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColorScheme, resolveWorldTheme } from '@hexly/web-core';
import { WorldThemePalette } from '@hexly/domain';
import { ThemeWarning, contrastReport } from '@hexly/web-styles';
import { COLOR_SCHEMES, PALETTE_CONTROLS, PaletteControl, controlValue } from '../utils/theme-draft';
import { ThemeContrastComponent } from './theme-contrast.component';
import { ThemeControlComponent } from './theme-control.component';

/** One control moved: which ColorScheme's Palette, which tier-1 token, and what the control emitted. */
export interface PaletteEdit {
  readonly scheme: ColorScheme;
  readonly control: PaletteControl;
  readonly raw: string;
}

/**
 * The Palettes an Owner authors: a row per tier-1 token, a column per ColorScheme (ADR-0075).
 *
 * Side by side rather than behind a switch — an Owner made to toggle their *own* ColorScheme to reach
 * the other half is being asked to change a reading preference to do an authoring job (ADR-0006).
 *
 * The rows are the manifest's tier-1 slice, so a newly declared anchor or knob appears here on its own.
 *
 * Each column head carries its own readability report, so the ColorScheme an Owner is *not* sitting in
 * is checked too and no half a Theme ships unlooked-at (ADR-0076).
 */
@Component({
  selector: 'app-theme-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ThemeContrastComponent, ThemeControlComponent],
  template: `
    <div class="grid">
      <span class="corner" aria-hidden="true"></span>
      @for (scheme of schemes; track scheme) {
        <div class="scheme-head" [attr.data-testid]="'theme-scheme-' + scheme">
          {{ 'common.colorScheme.' + scheme | transloco }}
          <app-theme-contrast [scheme]="scheme" [warnings]="reports()[scheme]" />
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
            [value]="valueFor(scheme, control)"
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
      @apply flex flex-col gap-1 self-start pb-1 font-display text-sm text-ink-strong;
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

  /**
   * What each Palette costs a reader, measured rather than predicted — including for the ColorScheme
   * nobody is currently in (ADR-0076).
   *
   * The anchors go through `resolveWorldTheme`, the same seam the preview paints by, so the report is
   * over exactly the declarations that would render. Measuring re-dresses the document root and puts it
   * straight back inside this one call: a paint happens between tasks and never inside one, so nothing
   * flickers, and no CSS had to be duplicated per `[data-color-scheme]` to make it true.
   */
  protected readonly reports = computed<Readonly<Record<ColorScheme, readonly ThemeWarning[]>>>(() => {
    const { solar, astral } = this.palettes();
    const declarations = resolveWorldTheme([{ solar, astral }]);
    return {
      solar: contrastReport('solar', declarations.solar),
      astral: contrastReport('astral', declarations.astral),
    };
  });

  protected valueFor(scheme: ColorScheme, control: PaletteControl): string {
    return controlValue(this.palettes()[scheme], control);
  }
}
