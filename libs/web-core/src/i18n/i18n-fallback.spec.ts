import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from './transloco-testing';

/**
 * English is the runtime fallback (ADR-0014): a gap in the French catalog must
 * render the English value, never a raw key. Catalogs here are fixtures, not the
 * project's real copy.
 */
describe('i18n fallback', () => {
  it('renders the English value when a French key is missing', () => {
    TestBed.configureTestingModule({
      imports: [
        provideTranslocoTesting({
          en: { auth: { heading: 'Sign in', signIn: 'Sign in' } },
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

  it("falls back across a scope, so a lib's French gap renders its English value too", () => {
    TestBed.configureTestingModule({
      imports: [
        provideTranslocoTesting({
          en: {},
          fr: {},
          'ui/en': { owners: { heading: 'Owners', add: 'Add owner' } },
          // The French catalog of a *scoped* lib, missing one key.
          'ui/fr': { owners: { heading: 'Propriétaires' } },
        }),
      ],
    });
    const transloco = TestBed.inject(TranslocoService);
    transloco.setActiveLang('fr');

    // A lib's catalog is loaded under its scope but flattened into the same key space as the app's
    // (ADR-0049), so the English fallback reaches into it exactly as it does the root catalog.
    expect(transloco.translate('ui.owners.heading')).toBe('Propriétaires');
    expect(transloco.translate('ui.owners.add')).toBe('Add owner');
  });
});
