import { inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

/** The languages Hexly ships (ADR-0014). English is the source and fallback. */
export type Locale = 'en' | 'fr';

const STORAGE_KEY = 'hexly-locale';

/**
 * Owns the active {@link Locale} for every actor — signed-in users and
 * anonymous public-link viewers alike — with no backend involvement (ADR-0014).
 * On first visit it follows the browser language (French when `navigator.language`
 * starts with `fr`, else English); thereafter a remembered choice wins. {@link set}
 * flips the active Transloco language so the UI updates live, and persists the
 * choice to `localStorage` so it survives reloads.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);

  /** The active locale, readable by the UI (e.g. to mark the switcher). */
  readonly lang = signal<Locale>(this.initial());

  constructor() {
    // Reflect the resolved locale onto Transloco so the first paint is correct.
    this.transloco.setActiveLang(this.lang());
  }

  /** Switch the UI language live and remember it for the next visit. */
  set(lang: Locale): void {
    this.lang.set(lang);
    this.transloco.setActiveLang(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage may be unavailable (private mode); the in-memory value holds */
    }
  }

  private initial(): Locale {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'fr') return stored;
    } catch {
      /* fall through to browser detection */
    }
    const browser =
      typeof navigator !== 'undefined' ? navigator.language : 'en';
    return browser?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  }
}
