import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { appRoutes } from './app.routes';

/** Every route in the tree (depth-first) that declares a `title`. */
function titledRoutes(routes: Route[]): Route[] {
  return routes.flatMap((r) => [
    ...(r.title !== undefined ? [r] : []),
    ...(r.children ? titledRoutes(r.children) : []),
  ]);
}

describe('appRoutes titles', () => {
  // Translation keys are dot-namespaced (e.g. "editorShell.tabTitle") and
  // automatically localized by TranslationTitleStrategy (ADR-0014).
  // Literal strings leak untranslated copy.
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
    // The parent guard pins the active World detail and heals its slug (ADR-0042).
    expect(parent?.canActivate?.length).toBeGreaterThan(1);
    expect(parent?.canDeactivate).toBeDefined();
    expect(parent?.loadComponent).toBeUndefined();

    const childPaths = parent?.children?.map((c) => c.path);
    expect(childPaths).toContain('entities');
    expect(childPaths).toContain('entities/:id');

    // World-less entity browser route removed; only World-scoped one remains.
    const topPaths = appRoutes.map((r) => r.path);
    expect(topPaths).not.toContain('entities');
    expect(topPaths).not.toContain('w/:worldId/entities');
  });

  it('keeps a World-agnostic entities/:id route that resolves and redirects to its World (#118)', () => {
    const redirect = appRoutes.find((r) => r.path === 'entities/:id');
    expect(redirect).toBeDefined();
    expect(redirect?.canActivate).toBeDefined();
    expect(redirect?.loadComponent).toBeDefined();
  });

  it('lands the World root on the Dashboard and moves Settings to /settings (ADR-0043)', async () => {
    const parent = appRoutes.find((r) => r.path === 'w/:worldId');
    const index = parent?.children?.find((c) => c.path === '');
    const settings = parent?.children?.find((c) => c.path === 'settings');
    expect(index?.loadComponent).toBeDefined();
    expect(settings?.loadComponent).toBeDefined();

    // Angular's compiler prefixes the emitted class name with an underscore.
    const dashboard = await index!.loadComponent!();
    const settingsPage = await settings!.loadComponent!();
    expect((dashboard as { name: string }).name).toMatch(/WorldDashboard$/);
    expect((settingsPage as { name: string }).name).toMatch(/WorldSettings$/);
  });

  it('serves the World Index at the root and renders the error page for unmatched URLs', () => {
    const root = appRoutes.find((r) => r.path === '');
    expect(root?.loadComponent).toBeDefined();
    expect(root?.redirectTo).toBeUndefined();

    const wildcard = appRoutes.find((r) => r.path === '**');
    expect(wildcard?.redirectTo).toBeUndefined();
    expect(wildcard?.loadComponent).toBeDefined();
  });

});
