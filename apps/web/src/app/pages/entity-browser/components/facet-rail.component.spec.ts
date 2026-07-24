import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { EntityFacets } from '@hexly/domain';
import { ClientConfigStore } from '@hexly/web-core';
import { mockClientConfigStore } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { FacetRailComponent } from './facet-rail.component';

/** The Visibility category is gated on the Collaboration layer (ADR-0071); Type and Tag are not. */
describe('FacetRail — the Visibility category under Collaboration (#316)', () => {
  let collaboration: WritableSignal<boolean>;

  function render(): ComponentFixture<FacetRailComponent> {
    collaboration = signal(true);
    TestBed.configureTestingModule({
      imports: [FacetRailComponent, provideTranslocoTesting()],
      providers: [{ provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration }) }],
    });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', {
      type: [{ value: 'core.type.note', count: 4 }],
      tag: [{ value: 'deity', count: 2 }],
      visibility: [
        { value: 'private', count: 3 },
        { value: 'shared', count: 1 },
      ],
      fields: [],
    } satisfies EntityFacets);
    fixture.detectChanges();
    return fixture;
  }

  const has = (fixture: ComponentFixture<FacetRailComponent>, tid: string) =>
    !!(fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${tid}"]`);

  it('renders the Visibility category with Collaboration on', () => {
    const fixture = render();

    expect(has(fixture, 'facet-heading-visibility')).toBe(true);
    expect(has(fixture, 'facet-visibility-private')).toBe(true);
  });

  it('drops the Visibility category with Collaboration off, keeping Type and Tag', () => {
    const fixture = render();
    collaboration.set(false);
    fixture.detectChanges();

    expect(has(fixture, 'facet-heading-visibility')).toBe(false);
    expect(has(fixture, 'facet-visibility-private')).toBe(false);
    expect(has(fixture, 'facet-visibility-shared')).toBe(false);
    expect(has(fixture, 'facet-heading-type')).toBe(true);
    expect(has(fixture, 'facet-heading-tag')).toBe(true);
  });
});

/**
 * A harvested facet dimension carries a `labelKey` the rail translates in the active Locale (#235,
 * ADR-0055), while a scalar Field's authored `label` renders as-is. A fixture scope (`fixture/*`) —
 * not the app's own `en`/`fr` catalog — supplies the dimension copy without clobbering the real one.
 */
describe('FacetRail — harvested dimension labels (#235)', () => {
  const CATALOGS = {
    'fixture/en': { threat: 'Threat Level', kind: { image: 'Image file' } },
    'fixture/fr': { threat: 'Niveau de menace', kind: { image: 'Fichier image' } },
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
          // A harvested enum dimension carrying a per-value key prefix (ADR-0055/0065): each value resolves
          // as `<valuesKeyPrefix>.<value>`. `mystery` has no copy — it must fall back to the raw token.
          key: 'fx_kind',
          label: 'fixture.kind',
          labelKey: 'fixture.threat',
          valuesKeyPrefix: 'fixture.kind',
          dataType: { kind: 'enum', options: ['image', 'mystery'] },
          values: [
            { value: 'image', count: 3 },
            { value: 'mystery', count: 1 },
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

  function render(): ComponentFixture<FacetRailComponent> {
    TestBed.configureTestingModule({ imports: [FacetRailComponent, provideTranslocoTesting(CATALOGS)] });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', facets());
    fixture.detectChanges();
    return fixture;
  }

  const heading = (fixture: ComponentFixture<FacetRailComponent>, key: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="facet-field-${key}"] h3`)?.textContent?.trim();

  const valueLabel = (fixture: ComponentFixture<FacetRailComponent>, key: string, value: string) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector(`[data-testid="facet-field-${key}-${value}"] span.truncate`)
      ?.textContent?.trim();

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

  it('translates a harvested dimension VALUE via its key prefix in the active Locale (ADR-0055/0065)', () => {
    const fixture = render();
    expect(valueLabel(fixture, 'fx_kind', 'image')).toBe('Image file');

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(valueLabel(fixture, 'fx_kind', 'image')).toBe('Fichier image');
  });

  it('falls back to the raw token for a dimension value with no copy, and for a scalar Field value', () => {
    const fixture = render();
    // Unknown value under a translated dimension → raw token, never the bare `<prefix>.<value>` key.
    expect(valueLabel(fixture, 'fx_kind', 'mystery')).toBe('mystery');
    // A scalar Field carries no `valuesKeyPrefix`, so its value renders verbatim.
    expect(valueLabel(fixture, 'alignment', 'lawful-good')).toBe('lawful-good');
  });

  it('picks the control from the dimension’s dataType: a numeric dimension renders a range', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    // Numeric dimension → range inputs; the enum scalar → value toggles.
    expect(el.querySelector('[data-testid="facet-field-fx_threat-gte"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="facet-field-alignment-lawful-good"]')).not.toBeNull();
  });
});
