import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  PALETTE_TOKENS,
  PaletteField,
  PalettePreset,
  PalettePresetId,
  PaletteToken,
  WORLD_THEME_SCHEME_KEYS,
  WorldThemePalette,
  palettePresetsFor,
} from '@hexly/domain';

/** One Anchor of a Preset, as the gallery shows it: the colour, and the tier-1 token it writes. */
interface AnchorSpecimen {
  readonly field: PaletteField;
  readonly token: PaletteToken;
  readonly value: string;
}

/** One Preset's card: what it is called, what it is painted in, and the Anchors it is drawn from. */
interface PresetSpecimen {
  readonly id: PalettePresetId;
  readonly values: WorldThemePalette;
  readonly anchors: readonly AnchorSpecimen[];
}

/** One ColorScheme's shelf of the gallery. */
interface PresetShelf {
  readonly scheme: (typeof WORLD_THEME_SCHEME_KEYS)[number];
  readonly presets: readonly PresetSpecimen[];
}

/**
 * A Preset's Anchors, in the manifest's own declaration order. The three knobs beside them are the
 * numbers the derivation turns rather than colours to show, which is exactly what tells them apart in
 * a stored Palette.
 */
function specimenOf(preset: PalettePreset): PresetSpecimen {
  const anchors = (Object.keys(PALETTE_TOKENS) as PaletteField[])
    .map((field) => ({ field, token: PALETTE_TOKENS[field], value: preset.values[field] }))
    .filter((anchor): anchor is AnchorSpecimen => typeof anchor.value === 'string');
  return { id: preset.id, values: preset.values, anchors };
}

/**
 * Every Palette Preset Hexly ships (#386) — the one surface that shows them to someone who is not
 * editing a World, so a reader can judge the Palettes on offer before committing to creating one.
 *
 * The offer is the domain's own table ({@link palettePresetsFor}), the same rule the editor's swatch
 * row follows: a Preset added there appears here with no edit. Shelved by ColorScheme because that is
 * the granularity a Preset has — ADR-0077 does not pair them.
 *
 * Each card is painted in the Preset's **own Anchors** rather than in the reader's active Palette, and
 * stops at those: every tier-2 role is declared at `:root` and inherits as an already-substituted
 * value, so a subtree cannot re-derive one (ADR-0075) — which is why the overrides grid does not
 * re-dress one either. The eight Anchors are what a Preset *is*, and the contrast gate is what says
 * the ink on that page is readable.
 *
 * The names are proper nouns and byte-identical across catalogs; only the one-line description is
 * localised (ADR-0077).
 */
@Component({
  selector: 'app-palette-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @for (shelf of shelves; track shelf.scheme) {
      <h3 class="shelf-title">{{ 'common.colorScheme.' + shelf.scheme | transloco }}</h3>
      <div class="shelf">
        @for (preset of shelf.presets; track preset.id) {
          <figure
            class="presetcard"
            [attr.data-testid]="'styleguide-preset-' + preset.id"
            [style.background]="preset.values.page"
            [style.color]="preset.values.ink"
            [style.border-color]="preset.values.inkQuiet"
          >
            <figcaption class="presetcard-head">
              <strong class="presetcard-name">{{ 'worldTheme.palettePresets.' + preset.id | transloco }}</strong>
              <span class="presetcard-hint" [style.color]="preset.values.inkQuiet">
                {{ 'worldTheme.palettePresetsHint.' + preset.id | transloco }}
              </span>
            </figcaption>
            <ul class="anchors">
              @for (anchor of preset.anchors; track anchor.field) {
                <li class="anchor">
                  <!-- Bordered in the Preset's own quiet ink: an Anchor equal to the page it sits on
                       would otherwise have no edge at all. The tier-1 token it writes rides the title,
                       as the page's other swatch specimens do, rather than a second line of monospace
                       on every one of the eight. -->
                  <span
                    class="anchor-chip"
                    [attr.data-token]="anchor.token"
                    [title]="anchor.token"
                    [style.background]="anchor.value"
                    [style.border-color]="preset.values.inkQuiet"
                  ></span>
                  <span class="anchor-name">{{ 'worldTheme.token.' + anchor.field | transloco }}</span>
                </li>
              }
            </ul>
          </figure>
        }
      </div>
    }
  `,
  styles: `
    @reference '#app-styles.css';

    :host {
      @apply flex flex-col gap-4;
    }
    .shelf-title {
      @apply text-md text-ink-strong;
    }
    .shelf {
      @apply grid gap-3;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    }
    .presetcard {
      @apply flex flex-col gap-3 m-0 p-4 rounded-md border shadow-1;
    }
    .presetcard-head {
      @apply flex flex-col gap-1;
    }
    .presetcard-name {
      @apply font-display text-md leading-tight;
    }
    .presetcard-hint {
      @apply text-sm leading-snug;
    }
    .anchors {
      @apply grid gap-x-3 gap-y-1.5 m-0 p-0 list-none;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    }
    .anchor {
      @apply flex items-center gap-2;
    }
    .anchor-chip {
      @apply h-5 w-5 flex-none rounded-sm border;
    }
    .anchor-name {
      @apply text-2xs leading-tight truncate;
    }
  `,
})
export class PaletteGalleryComponent {
  protected readonly shelves: readonly PresetShelf[] = WORLD_THEME_SCHEME_KEYS.map((scheme) => ({
    scheme,
    presets: palettePresetsFor(scheme).map(specimenOf),
  }));
}
