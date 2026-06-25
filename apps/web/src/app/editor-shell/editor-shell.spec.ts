import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  provideRouter,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { TitleService } from '../core/i18n/title.service';
import { EditorStore } from './editor-store';
import { EditorShell } from './editor-shell';

describe('EditorShell', () => {
  let httpMock: HttpTestingController;
  // The route's params, swappable per test so a test can open a specific map.
  let routeParams: Observable<ParamMap> = of(convertToParamMap({}));

  beforeEach(async () => {
    routeParams = of(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [EditorShell, provideTranslocoTesting()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          // A getter so a test can swap `routeParams` before createComponent
          // reads paramMap.
          useValue: {
            get paramMap() {
              return routeParams;
            },
          },
        },
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

  it('opens the entity named by the route id, loading its hex grid into the editor', () => {
    routeParams = of(convertToParamMap({ id: 'm1' }));

    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    httpMock.expectOne('/entities/m1').flush({
      id: 'm1',
      ownerId: 'u1',
      name: 'Aldermoor',
      type: 'hexmap',
      tags: [],
      visibility: 'private',
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      document: {
        type: 'hexmap',
        content: { format: 'tiptap-v1', snapshot: {} },
        hexes: { '0,0': { terrain: 'forest' } },
        regions: [],
        labels: [],
      },
    });

    // The editor sees the bare grid the seam unwrapped from the body.
    expect(TestBed.inject(EditorStore).document()).toEqual({
      hexes: { '0,0': { terrain: 'forest' } },
      regions: [],
      labels: [],
    });
  });

  it('titles the tab with the open map name, and clears it when it leaves', async () => {
    routeParams = of(convertToParamMap({ id: 'm1' }));

    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    httpMock.expectOne('/entities/m1').flush({
      id: 'm1',
      ownerId: 'u1',
      name: 'Aldermoor',
      type: 'hexmap',
      tags: [],
      visibility: 'private',
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      document: {
        type: 'hexmap',
        content: { format: 'tiptap-v1', snapshot: {} },
        hexes: {},
        regions: [],
        labels: [],
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    // The editor pushes the open map's name so the tab reads "Aldermoor — Hexly".
    const titles = TestBed.inject(TitleService);
    expect(titles.documentName()).toBe('Aldermoor');

    // Leaving the editor clears the name so it can't shadow the next page's title.
    fixture.destroy();
    expect(titles.documentName()).toBeNull();
  });
});
