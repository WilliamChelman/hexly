import { provideTranslocoTesting } from '../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
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

    expect(transloco.translate('styleguide.tabTitle')).toBe('Hexly — Design system');
    expect(transloco.translate('editorShell.tabTitle')).toBe('Hexly');

    transloco.setActiveLang('fr');

    expect(transloco.translate('styleguide.tabTitle')).toBe('Hexly — Système de design');
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
    // A thin layout owns the scope now — it fills the rail's contextual links (ADR-0041).
    expect(parent?.loadComponent).toBeDefined();

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

  // Two real chunk loads, so this is import-bound, not compute-bound: under a loaded worker pool
  // the default 5 s lapses long before the assertions are reached. The timeout guards against a
  // route that never resolves, and 20 s says that just as well.
  it('lands the World root on the Dashboard and moves Settings to /settings (ADR-0043)', async () => {
    const parent = appRoutes.find((r) => r.path === 'w/:worldId');
    const index = parent?.children?.find((c) => c.path === '');
    const settings = parent?.children?.find((c) => c.path === 'settings');
    expect(index?.loadComponent).toBeDefined();
    expect(settings?.loadComponent).toBeDefined();

    // Angular's compiler prefixes the emitted class name with an underscore.
    const dashboard = await index!.loadComponent!();
    const settingsPage = await settings!.loadComponent!();
    expect((dashboard as { name: string }).name).toMatch(/WorldDashboardPage$/);
    expect((settingsPage as { name: string }).name).toMatch(/WorldSettingsPage$/);
  }, 20_000);

  /**
   * ADR-0079's Compendium browse became the Library (ADR-0080, #412). `compendium/:compendiumId` is a
   * two-segment full match, so a bare `/w/:worldId/compendium` matched nothing and fell to the wildcard.
   */
  it('keeps the old Compendium browse path a door into the Library it became', () => {
    const parent = appRoutes.find((r) => r.path === 'w/:worldId');
    const compendium = parent?.children?.find((c) => c.path === 'compendium');

    expect(compendium?.redirectTo).toBe('library');
    expect(compendium?.pathMatch).toBe('full');
    // Still its own route, so a pack page is not swallowed by the redirect.
    expect(parent?.children?.find((c) => c.path === 'compendium/:compendiumId')?.loadComponent).toBeDefined();
  });

  it('redirects the root to the World Index and renders the error page for unmatched URLs', () => {
    const root = appRoutes.find((r) => r.path === '');
    expect(root?.redirectTo).toBe('worlds');
    expect(root?.loadComponent).toBeUndefined();

    const index = appRoutes.find((r) => r.path === 'worlds');
    expect(index?.redirectTo).toBeUndefined();
    expect(index?.loadComponent).toBeDefined();

    const wildcard = appRoutes.find((r) => r.path === '**');
    expect(wildcard?.redirectTo).toBeUndefined();
    expect(wildcard?.loadComponent).toBeDefined();
  });
});
