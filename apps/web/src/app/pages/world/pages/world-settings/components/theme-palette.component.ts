import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColorScheme, ThemeDeclarationSet } from '@hexly/web-core';
import { PalettePreset, WorldThemePalette } from '@hexly/domain';
import { ThemeWarning, contrastReport } from '@hexly/web-styles';
import { COLOR_SCHEMES, PALETTE_CONTROLS, PaletteControl, SchemeEdit, controlValue } from '../utils/theme-draft';
import { ThemeContrastComponent } from './theme-contrast.component';
import { ThemeControlComponent } from './theme-control.component';
import { ThemePresetsComponent } from './theme-presets.component';

/** One control moved: which ColorScheme's Palette, which tier-1 token, and what the control emitted. */
export type PaletteEdit = SchemeEdit<PaletteControl>;

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
 *
 * A row of Palette Presets heads each column, directly above the eleven controls it seeds — and each
 * column is picked on its own, since ADR-0077 does not pair them.
 */
@Component({
  selector: 'app-theme-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ThemeContrastComponent, ThemeControlComponent, ThemePresetsComponent],
  template: `
    <div class="grid">
      <!-- The header row's empty first cell: the row-label column has no heading of its own. -->
      <span aria-hidden="true"></span>
      @for (scheme of schemes; track scheme) {
        <div class="scheme-head" [attr.data-testid]="'theme-scheme-' + scheme">
          {{ 'common.colorScheme.' + scheme | transloco }}
          <app-theme-contrast [scheme]="scheme" [warnings]="reports()[scheme]" />
        </div>
      }

      <div class="row-label">
        <span class="row-name">{{ 'worldTheme.palettePresetsLabel' | transloco }}</span>
      </div>
      @for (scheme of schemes; track scheme) {
        <app-theme-presets
          class="presets"
          [scheme]="scheme"
          [palette]="palettes()[scheme]"
          (picked)="presetPicked.emit($event)"
        />
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
      /* The scheme columns hold a Preset card — swatch, name and description — so they are sized for
         that rather than for the colour well, which is the narrowest thing in them. */
      grid-template-columns: minmax(9rem, 1fr) minmax(13rem, 1fr) minmax(13rem, 1fr);
    }
    /* Its own row, so the Presets sit between the column head and the controls they seed. */
    .presets {
      @apply self-start pb-2;
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

  /** The whole chain the preview paints by, which is what the report has to be measured over. */
  readonly declarations = input.required<ThemeDeclarationSet>();

  readonly changed = output<PaletteEdit>();

  /** A ready-made Palette taken for one ColorScheme; the other column is untouched by it (ADR-0077). */
  readonly presetPicked = output<PalettePreset>();

  protected readonly controls = PALETTE_CONTROLS;
  protected readonly schemes = COLOR_SCHEMES;

  /**
   * What each Palette costs a reader, measured rather than predicted — including for the ColorScheme
   * nobody is currently in (ADR-0076). Over {@link declarations}, not {@link palettes}: a tier-2
   * override moves a role no anchor names.
   *
   * A `computed` may do this only because `measureScheme` is observationally pure: it clears what is
   * inline, reads, and restores the root in a `finally`, all inside one task. So the report is a
   * function of its declarations and the stylesheets alone, which is what makes memoising it sound.
   */
  protected readonly reports = computed<Readonly<Record<ColorScheme, readonly ThemeWarning[] | null>>>(() => {
    const declarations = this.declarations();
    return {
      light: contrastReport('light', declarations.light),
      dark: contrastReport('dark', declarations.dark),
    };
  });

  protected valueFor(scheme: ColorScheme, control: PaletteControl): string {
    return controlValue(this.palettes()[scheme], control);
  }
}
