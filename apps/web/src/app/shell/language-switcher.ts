import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Locale, LocaleService } from '../core/i18n/locale.service';
import { LOCALES } from '../core/i18n/transloco.config';
import { Button } from '../ui/button';

/**
 * The EN↔FR language switcher that lives in the {@link AppHeader} (ADR-0014).
 * A segmented pair of ghost buttons; pressing one flips the UI language live
 * (no reload) through {@link LocaleService}, which also persists the choice. It
 * needs no account, so it works for every actor — including anonymous
 * public-link viewers.
 */
@Component({
  selector: 'app-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="group" role="group" aria-label="Language">
      @for (locale of locales; track locale) {
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          class="option"
          [class.active]="locale === current()"
          [attr.data-testid]="'lang-' + locale"
          [attr.aria-pressed]="locale === current()"
          [title]="names[locale]"
          (click)="select(locale)"
        >
          {{ locale.toUpperCase() }}
        </button>
      }
    </div>
  `,
  styles: `
    .group {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }
    .option {
      color: var(--ink-muted);
      font-family: var(--font-mono);
    }
    .option.active {
      color: var(--ink-strong);
      background: var(--gold-soft);
    }
  `,
})
export class LanguageSwitcher {
  private readonly locale = inject(LocaleService);

  protected readonly locales = LOCALES;
  /** The active locale, used to mark the pressed option. */
  protected readonly current = this.locale.lang;
  /** Full names for the hover/title affordance on each short code. */
  protected readonly names: Record<Locale, string> = {
    en: 'English',
    fr: 'Français',
  };

  protected select(locale: Locale): void {
    this.locale.set(locale);
  }
}
