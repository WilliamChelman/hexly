import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { EditorShell } from './editor-shell';

// EditorShell is a pure view: EntityPage loads the routed Entity into the
// EditorSession and the session owns the tab title (see entity.page.spec /
// editor-session.spec). This covers only the layout shell it still owns.
describe('EditorShell', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorShell, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('renders the API health reported in the status bar', async () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges(); // triggers ngOnInit -> GET /health

    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    await fixture.whenStable();
    fixture.detectChanges();

    const health = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="health"]',
    );
    expect(health?.textContent).toContain('ok');
    expect(health?.textContent).toContain('api');
  });

  it('arms the non-destructive Select tool by default', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    // A map opens armed with Select so a stray first click never paints (issue #27).
    // The floating strip is icon-only now, so arming reads from the button's pressed
    // state rather than a text label (ADR-0013).
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid=tool-select]',
    );
    expect(select?.getAttribute('aria-pressed')).toBe('true');
  });

  it('boots to a clear map: a full-bleed canvas, a bare rail, and the panel closed', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    const el = fixture.nativeElement as HTMLElement;
    // The canvas and the floating strip + rail are present, but nothing covers the
    // map: the right panel is closed by default, so neither the Inspector nor the
    // Regions list renders until there's something to show (ADR-0013, story 20).
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-tool-palette')).not.toBeNull();
    expect(el.querySelector('app-editor-rail')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
    expect(el.querySelector('app-regions-panel')).toBeNull();
  });

  it('opens the Regions panel from the closed default via the rail', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    const el = fixture.nativeElement as HTMLElement;
    // Closed by default — no panel floats over the map.
    expect(el.querySelector('app-regions-panel')).toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();

    // The right-edge rail's first entry opens the Regions panel as a floating card.
    (el.querySelector('[data-testid=rail-regions]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('app-regions-panel')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
  });
});
