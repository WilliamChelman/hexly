import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from './core/i18n/transloco-testing';
import { appRoutes } from './app.routes';

/** Every route in the tree (depth-first) that declares a `title`. */
function titledRoutes(routes: Route[]): Route[] {
  return routes.flatMap((r) => [
    ...(r.title !== undefined ? [r] : []),
    ...(r.children ? titledRoutes(r.children) : []),
  ]);
}

describe('appRoutes titles', () => {
  // A translation key is dot-namespaced with no spaces ("editorShell.tabTitle");
  // a literal title ("Hexly", "Hexly — Design system") is not. The
  // TranslationTitleStrategy (ADR-0014) localizes the former; the latter would
  // leak untranslated copy into the tab/history.
  const TRANSLATION_KEY = /^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/;

  it('routes every title through a translation key, never a literal string', () => {
    const titled = titledRoutes(appRoutes);
    expect(titled.length).toBeGreaterThan(0);
    for (const route of titled) {
      expect(route.title as string).toMatch(TRANSLATION_KEY);
    }
  });

  it('localizes the styleguide and editor tab titles, keeping Hexly untranslated', () => {
    TestBed.configureTestingModule({ imports: [provideTranslocoTesting()] });
    const transloco = TestBed.inject(TranslocoService);

    expect(transloco.translate('styleguide.tabTitle')).toBe(
      'Hexly — Design system',
    );
    expect(transloco.translate('editorShell.tabTitle')).toBe('Hexly');

    transloco.setActiveLang('fr');

    expect(transloco.translate('styleguide.tabTitle')).toBe(
      'Hexly — Système de design',
    );
    expect(transloco.translate('editorShell.tabTitle')).toBe('Hexly');
  });
});
