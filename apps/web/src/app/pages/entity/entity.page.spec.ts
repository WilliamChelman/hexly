import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { of } from 'rxjs';
import { CONTENT_FORMAT, EntityDetail, EntityType } from '@hexly/domain';
import { EntitySession } from './services/entity-session';
import { EntityNameResolver } from './services/entity-name-resolver';
import { TitleService } from '../../core/i18n/title.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { HexMapStore } from './services/hexmap-store';
import { noteDetail } from './components/entity-detail.fixtures';
import { EntityPage } from './entity.page';

/** Flush the status bar's health probe so afterEach's verify() is satisfied (hexmap only). */
function flushHealth(http: HttpTestingController) {
  http.expectOne('/api/health').flush({ status: 'ok', service: 'api' });
}

// Hexmap with a populated Content body, to prove the Note view seeds it (#75).
const hexmapWithContent = (text: string): EntityDetail => ({
  id: 'm1',
  ownerId: 'u1',
  worldId: 'w1',
  name: 'The Reach of Aldermoor',
  type: 'hexmap',
  tags: [],
  visibility: 'private',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  document: {
    type: 'hexmap',
    content: {
      format: CONTENT_FORMAT,
      snapshot: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    },
    hexes: {},
    regions: [],
    labels: [],
  },
});

// Routing/load/title/404: the page drives the session off the route's `:id`.
describe('EntityPage routing', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const detail = (id: string, type: EntityType): EntityDetail =>
    type === 'note'
      ? noteDetail('Lady Mara')
      : { ...hexmapWithContent('The reach lies north.'), id, name: 'Aldermoor' };

  async function render(id: string) {
    await TestBed.configureTestingModule({
      imports: [EntityPage, provideTranslocoTesting()],
      providers: [
        EntitySession,
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('shows the Content body for a note', async () => {
    const fixture = await render('n1');
    http.expectOne('/api/entities/n1').flush(detail('n1', 'note'));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
  });

  it('shows the map editor for a hexmap', async () => {
    const fixture = await render('m1');
    http.expectOne('/api/entities/m1').flush(detail('m1', 'hexmap'));
    fixture.detectChanges();
    flushHealth(http);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
  });

  it('titles the tab with the open Entity name (owned by the session, not the view)', async () => {
    const fixture = await render('m1');
    http.expectOne('/api/entities/m1').flush(detail('m1', 'hexmap'));
    fixture.detectChanges();
    flushHealth(http);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(TitleService).documentName()).toBe('Aldermoor');
  });

  it('returns to the library when the Entity fails to load', async () => {
    const fixture = await render('gone');
    http
      .expectOne('/api/entities/gone')
      .flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith('/entities');
  });
});

// Layout: the body the page lays out for each Entity type/surface, driven off an
// adopted Entity (no routing). Routing lives in the suite above.
describe('EntityPage layout', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityPage, provideTranslocoTesting()],
      providers: [
        EntitySession,
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('arms the non-destructive Select tool by default', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    flushHealth(http);

    // Maps open armed with Select so a stray first click never paints (#27).
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid=tool-select]',
    );
    expect(select?.getAttribute('aria-pressed')).toBe('true');
  });

  it('boots to a clear map: a full-bleed canvas, a bare rail, and the panel closed', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    flushHealth(http);

    const el = fixture.nativeElement as HTMLElement;
    // Canvas, strip, and rail present; right panel closed by default (ADR-0013, story 20).
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-tool-palette')).not.toBeNull();
    expect(el.querySelector('app-editor-rail')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
    expect(el.querySelector('app-regions-panel')).toBeNull();
  });

  it('reports the API health in the status bar', async () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges(); // status bar -> GET /health
    http.expectOne('/api/health').flush({ status: 'ok', service: 'api' });
    await fixture.whenStable();
    fixture.detectChanges();

    const health = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="health"]',
    );
    expect(health?.textContent).toContain('ok');
    expect(health?.textContent).toContain('api');
  });

  it('shows the hex canvas in the Map view, not the Content editor', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    flushHealth(http);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-content-editor')).toBeNull();
  });

  it('swaps the canvas for the Content editor in the Note view, seeded with the map’s Content', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges(); // mounts on the grid (watchRoute seeds view=map from the empty route)
    flushHealth(http);
    // Flip to the Note view after mount, as the header's toggle would.
    TestBed.inject(HexMapStore).setView('note');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Note view: Content editor takes the body, canvas gone — but the status bar stays.
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
    const surface = el.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('The reach lies north.');
  });

  it('opens the Regions panel from the closed default via the rail', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    flushHealth(http);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-regions-panel')).toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();

    (el.querySelector('[data-testid=rail-regions]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('app-regions-panel')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
  });

  it('shows the open note’s name, with no status bar or canvas', () => {
    TestBed.inject(EntitySession).adopt(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lady Mara');
    // A note has no grid: no map canvas, no status bar (and no /api/health probe).
    expect(el.querySelector('app-map-canvas')).toBeNull();
    expect(el.querySelector('app-status-bar')).toBeNull();
  });

  it('mounts the shared Content editor for a note, seeded with its stored Content', () => {
    TestBed.inject(EntitySession).adopt({
      ...noteDetail('Lady Mara'),
      document: {
        type: 'note',
        content: {
          format: 'tiptap-v1',
          snapshot: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Lady Mara rules the north.' }],
              },
            ],
          },
        },
      },
    });
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    const surface = el.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('Lady Mara rules the north.');
  });

  it('mounts the tag editor for the open note', () => {
    TestBed.inject(EntitySession).adopt(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid=entity-tags]',
      ),
    ).not.toBeNull();
  });
});
