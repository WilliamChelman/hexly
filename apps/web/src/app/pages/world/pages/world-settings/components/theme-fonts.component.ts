import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CardRadioComponent, CardRadioGroupComponent } from '@hexly/web-ui';
import { PublicDesignToken, designTokenInitial } from '@hexly/web-styles';
import { FontPairingId } from '@hexly/domain';
import { FONT_PAIRING_CHOICES, FontPairingChoice } from '../utils/theme-draft';

/** What the absence is keyed on — no pairing is a `FontPairingId`, and it still needs copy and a test id. */
const DEFAULT_KEY = 'default';

/** One option on offer: a curated pairing, or the absence a World wears by storing no pairing. */
interface PairingOption {
  /** What the option is stored as — absent for the absence, which is a choice and so has a name too. */
  readonly id?: FontPairingId;
  /** That name: what its copy and its test id are keyed on. */
  readonly key: string;
  readonly tokens: FontPairingChoice['tokens'];
}

/**
 * The font pairing an Owner picks (spec §5.4, #375). Curated from the bundled families rather than
 * uploaded — a pairing naming a family the app does not ship would render as nothing (ADR-0076).
 *
 * Each option is a **specimen**: the four faces it writes, rendered in themselves, off the pairing's
 * own stacks — so the picker cannot show a face the applier will not write, and a pairing added to the
 * curated table needs only its copy.
 */
@Component({
  selector: 'app-theme-fonts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, CardRadioComponent, CardRadioGroupComponent],
  template: `
    <div appCardRadioGroup [attr.aria-label]="'worldTheme.fontsHeading' | transloco">
      @for (option of options; track option.key) {
        <app-card-radio
          name="theme-font-pairing"
          basis="16rem"
          [testId]="'theme-font-' + option.key"
          [checked]="option.key === selected()"
          [label]="'worldTheme.fonts.' + option.key | transloco"
          [hint]="'worldTheme.fontsHint.' + option.key | transloco"
          (picked)="picked.emit(option.id)"
        >
          <span cardBelow class="specimen" aria-hidden="true">
            <span class="cartouche" [style.fontFamily]="stack(option, '--font-cartouche')">Hexly</span>
            <span class="display" [style.fontFamily]="stack(option, '--font-display')">
              {{ 'worldTheme.fontsSpecimen.display' | transloco }}
            </span>
            <span class="body" [style.fontFamily]="stack(option, '--font-body')">
              {{ 'worldTheme.fontsSpecimen.body' | transloco }}
            </span>
            <span class="mono" [style.fontFamily]="stack(option, '--font-mono')">04.12 · 08N</span>
          </span>
        </app-card-radio>
      }
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .specimen {
      @apply flex flex-col gap-0.5 border-t border-line-faint pt-2;
    }
    .cartouche {
      @apply text-2xs font-bold uppercase tracking-wider text-ink-muted;
    }
    .display {
      @apply text-lg text-ink-strong;
    }
    .body {
      @apply text-sm text-ink;
    }
    .mono {
      @apply text-2xs tabular-nums text-ink-muted;
    }
  `,
})
export class ThemeFontsComponent {
  /** The pairing the draft carries; absent for a World that stores none. */
  readonly fontPairing = input.required<FontPairingId | undefined>();

  readonly picked = output<FontPairingId | undefined>();

  protected readonly options: readonly PairingOption[] = [
    { key: DEFAULT_KEY, tokens: {} },
    ...FONT_PAIRING_CHOICES.map((choice) => ({ ...choice, key: choice.id })),
  ];

  protected readonly selected = computed(() => this.fontPairing() ?? DEFAULT_KEY);

  /**
   * The face this option sets for a token. The default option falls back to the manifest rather than to
   * inheritance: the draft is previewed on the root while the picker is open, so an inherited specimen
   * would show the pairing being previewed and never the one it stands for.
   */
  protected stack(option: PairingOption, token: PublicDesignToken): string {
    return option.tokens[token] ?? designTokenInitial(token);
  }
}
