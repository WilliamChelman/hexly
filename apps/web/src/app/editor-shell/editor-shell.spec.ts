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
import { EditorStore } from './editor-store';
import { EditorShell } from './editor-shell';

describe('EditorShell', () => {
  let httpMock: HttpTestingController;
  // The route's params, swappable per test so a test can open a specific map.
  let routeParams: Observable<ParamMap> = of(convertToParamMap({}));

  beforeEach(async () => {
    routeParams = of(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [EditorShell],
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

  it('arms the painted terrain tool by default', () => {
    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    const active = (fixture.nativeElement as HTMLElement).querySelector(
      'button[appTool].is-active',
    );
    expect(active?.textContent).toContain('Forest');
  });

  it('opens the map named by the route id, loading its document into the editor', () => {
    routeParams = of(convertToParamMap({ id: 'm1' }));

    const fixture = TestBed.createComponent(EditorShell);
    fixture.detectChanges();
    httpMock.expectOne('/health').flush({ status: 'ok', service: 'api' });

    httpMock.expectOne('/maps/m1').flush({
      id: 'm1',
      ownerId: 'u1',
      title: 'Aldermoor',
      visibility: 'private',
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      document: { hexes: { '0,0': { terrain: 'forest' } } },
    });

    expect(TestBed.inject(EditorStore).document()).toEqual({
      hexes: { '0,0': { terrain: 'forest' } },
    });
  });
});
