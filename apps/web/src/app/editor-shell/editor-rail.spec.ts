import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { HexMapStore } from './hexmap-store';
import { EditorRail } from './editor-rail';

function setup() {
  const fixture = TestBed.createComponent(EditorRail);
  const store = TestBed.inject(HexMapStore);
  fixture.detectChanges();
  const regions = () =>
    fixture.nativeElement.querySelector(
      '[data-testid=rail-regions]',
    ) as HTMLButtonElement;
  return { fixture, store, regions };
}

describe('EditorRail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EditorRail, provideTranslocoTesting()] }).compileComponents();
  });

  it('renders the Regions entry inactive while the panel is closed', () => {
    const { regions } = setup();

    // The rail floats with a bare Regions entry; with the panel closed by default
    // the entry reads inactive (ADR-0013).
    expect(regions()).not.toBeNull();
    expect(regions().getAttribute('aria-pressed')).toBe('false');
  });

  it('labels the Regions entry in French when French is the active language', () => {
    const { fixture, regions } = setup();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    // The icon-only entry carries its name on aria-label/title for assistive tech.
    expect(regions().getAttribute('aria-label')).toBe('Régions');
    expect(regions().getAttribute('title')).toBe('Régions');
  });

  it('opens the Regions panel and marks the entry active when clicked', () => {
    const { fixture, store, regions } = setup();

    regions().click();
    fixture.detectChanges();

    expect(store.rightPanel()).toBe('regions');
    expect(regions().getAttribute('aria-pressed')).toBe('true');
  });

  it('closes the panel and clears the active entry when clicked again', () => {
    const { fixture, store, regions } = setup();

    regions().click(); // open
    fixture.detectChanges();
    regions().click(); // and the active entry toggles back closed (story 18)
    fixture.detectChanges();

    expect(store.rightPanel()).toBeNull();
    expect(regions().getAttribute('aria-pressed')).toBe('false');
  });

  it('reads active whenever the Regions list is showing, however it was opened', () => {
    const { fixture, store, regions } = setup();

    // Opened through the store (e.g. New Region's showRegionsPanel) rather than the
    // rail click — the entry still reflects the live panel state.
    store.showRegionsPanel();
    fixture.detectChanges();

    expect(regions().getAttribute('aria-pressed')).toBe('true');
  });
});
