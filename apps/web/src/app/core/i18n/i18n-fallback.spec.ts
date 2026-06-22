import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import en from '../../../../public/assets/i18n/en.json';
import { provideTranslocoTesting } from './transloco-testing';

/**
 * English is the runtime fallback (ADR-0014): a gap in the French catalog must
 * render the English value, never a raw key, so the UI is never broken by an
 * untranslated string.
 */
describe('i18n fallback', () => {
  it('renders the English value when a French key is missing', () => {
    TestBed.configureTestingModule({
      imports: [
        provideTranslocoTesting({
          en,
          // A deliberately incomplete French catalog: auth.signIn is absent.
          fr: { auth: { heading: 'Se connecter' } },
        }),
      ],
    });
    const transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('fr');

    // The present key resolves to French; the missing one yields the English
    // value, not the literal key 'auth.signIn'.
    expect(transloco.translate('auth.heading')).toBe('Se connecter');
    expect(transloco.translate('auth.signIn')).toBe('Sign in');
  });
});
