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

describe('appRoutes structure (ADR-0028)', () => {
  it('nests the entity routes under a :worldId parent that pins and clears the active World', () => {
    const parent = appRoutes.find((r) => r.path === 'w/:worldId');
    expect(parent).toBeDefined();
    // The parent owns the World scope: resolver pins, canDeactivate clears, no component.
    expect(parent?.resolve).toBeDefined();
    expect(parent?.canDeactivate).toBeDefined();
    expect(parent?.loadComponent).toBeUndefined();

    const childPaths = parent?.children?.map((c) => c.path);
    expect(childPaths).toContain('entities');
    expect(childPaths).toContain('entities/:id');

    // The flat routes are gone — there is no World-less entities route.
    const topPaths = appRoutes.map((r) => r.path);
    expect(topPaths).not.toContain('entities');
    expect(topPaths).not.toContain('entities/:id');
    expect(topPaths).not.toContain('w/:worldId/entities');
  });

  it('serves the World Index at the root and falls unmatched URLs back to it', () => {
    const root = appRoutes.find((r) => r.path === '');
    expect(root?.loadComponent).toBeDefined();
    expect(root?.redirectTo).toBeUndefined();

    expect(appRoutes.find((r) => r.path === '**')?.redirectTo).toBe('');
  });
});
