import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { EntityFacets } from '@hexly/domain';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { FacetRail } from './facet-rail';

/**
 * A harvested facet dimension carries a `labelKey` the rail translates in the active Locale (#235,
 * ADR-0055), while a scalar Field's authored `label` renders as-is. A fixture scope (`fixture/*`) —
 * not the app's own `en`/`fr` catalog — supplies the dimension copy without clobbering the real one.
 */
describe('FacetRail — harvested dimension labels (#235)', () => {
  const CATALOGS = {
    'fixture/en': { threat: 'Threat Level' },
    'fixture/fr': { threat: 'Niveau de menace' },
  };

  /** A facets payload carrying one harvested-dimension facet (`labelKey`) and one scalar Field facet. */
  function facets(): EntityFacets {
    return {
      type: [],
      tag: [],
      visibility: [],
      fields: [
        {
          key: 'fx_threat',
          // The untranslated fallback; the rail resolves `labelKey` for the visible label.
          label: 'fixture.threat',
          labelKey: 'fixture.threat',
          dataType: { kind: 'number' },
          values: [
            { value: '1', count: 1 },
            { value: '10', count: 1 },
          ],
        },
        {
          key: 'alignment',
          label: 'Alignment',
          dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
          values: [{ value: 'lawful-good', count: 1 }],
        },
      ],
    };
  }

  function render(): ComponentFixture<FacetRail> {
    TestBed.configureTestingModule({ imports: [FacetRail, provideTranslocoTesting(CATALOGS)] });
    const fixture = TestBed.createComponent(FacetRail);
    fixture.componentRef.setInput('facetCounts', facets());
    fixture.detectChanges();
    return fixture;
  }

  const heading = (fixture: ComponentFixture<FacetRail>, key: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="facet-field-${key}"] h3`)?.textContent?.trim();

  it('renders a harvested dimension label translated in the active Locale, not the raw key', () => {
    const fixture = render();
    expect(heading(fixture, 'fx_threat')).toBe('Threat Level');

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(heading(fixture, 'fx_threat')).toBe('Niveau de menace');
  });

  it('renders a scalar Field facet with its authored label, untranslated', () => {
    const fixture = render();
    expect(heading(fixture, 'alignment')).toBe('Alignment');
  });

  it('picks the control from the dimension’s dataType: a numeric dimension renders a range', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    // Numeric dimension → range inputs; the enum scalar → value toggles.
    expect(el.querySelector('[data-testid="facet-field-fx_threat-gte"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="facet-field-alignment-lawful-good"]')).not.toBeNull();
  });
});
