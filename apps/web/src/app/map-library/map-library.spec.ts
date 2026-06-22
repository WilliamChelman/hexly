import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MapSummary } from '@hexly/domain';
import { AuthStore } from '../auth/auth.store';
import { HeaderService } from '../shell/header.service';
import { MapLibrary } from './map-library';

describe('MapLibrary', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const summary = (over: Partial<MapSummary>): MapSummary => ({
    id: 'x',
    ownerId: 'u1',
    title: 'A map',
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapLibrary],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // A signed-in user the library header can display.
    TestBed.inject(AuthStore).login('ada@hexly.test', 'pw').subscribe();
    http.expectOne('/auth/login').flush({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
    });
  });

  afterEach(() => http.verify());

  /** Create the library and resolve its initial list with `maps`. */
  function renderWith(maps: MapSummary[]) {
    const fixture = TestBed.createComponent(MapLibrary);
    fixture.detectChanges(); // ngOnInit -> GET /maps
    http.expectOne('/maps').flush(maps);
    fixture.detectChanges();
    return fixture;
  }

  it('contributes its heading to the app header while open', () => {
    renderWith([]);

    const header = TestBed.inject(HeaderService);
    expect(header.eyebrow()).toBe('Library');
    expect(header.title()).toBe('Your maps');
  });

  it('clears its heading from the app header when it leaves', () => {
    const fixture = renderWith([]);

    fixture.destroy();

    const header = TestBed.inject(HeaderService);
    expect(header.title()).toBeNull();
  });

  it('lists the maps the user owns, newest first', () => {
    const fixture = renderWith([
      summary({ id: 'older', title: 'The Whisperwood', updatedAt: 100 }),
      summary({ id: 'newest', title: 'Aldermoor', updatedAt: 300 }),
    ]);

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=map-title]'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['Aldermoor', 'The Whisperwood']);
  });

  it('shows an empty state when the user has no maps', () => {
    const fixture = renderWith([]);

    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid=map-title]'),
    ).toBeNull();
  });

  it('shows an error state when the map list fails to load', () => {
    const fixture = TestBed.createComponent(MapLibrary);
    fixture.detectChanges(); // ngOnInit -> GET /maps
    http
      .expectOne('/maps')
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // A failed list surfaces an error panel rather than a permanently blank page.
    expect(
      fixture.nativeElement.querySelector('[data-testid=load-error]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=empty]')).toBeNull();
  });

  it('creates a new map and opens it in the editor', () => {
    const fixture = renderWith([]);

    (
      fixture.nativeElement.querySelector('[data-testid=new-map]') as HTMLButtonElement
    ).click();

    const req = http.expectOne('/maps');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ title: 'Untitled map' });
    req.flush({ ...summary({ id: 'created', title: 'Untitled map' }), document: { hexes: {} } });

    expect(navigate).toHaveBeenCalledWith(['/maps', 'created']);
  });

  it('opens a map when its card is activated', () => {
    const fixture = renderWith([summary({ id: 'm1', title: 'Aldermoor' })]);

    (
      fixture.nativeElement.querySelector('[data-testid=open-m1]') as HTMLElement
    ).click();

    expect(navigate).toHaveBeenCalledWith(['/maps', 'm1']);
  });

  it('deletes a map and removes it from the list', () => {
    const fixture = renderWith([
      summary({ id: 'm1', title: 'Aldermoor' }),
      summary({ id: 'm2', title: 'The Whisperwood' }),
    ]);

    (
      fixture.nativeElement.querySelector('[data-testid=delete-m1]') as HTMLButtonElement
    ).click();
    http.expectOne('/maps/m1').flush(null);
    fixture.detectChanges();

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=map-title]'),
    ).map((el) => (el as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['The Whisperwood']);
  });
});
