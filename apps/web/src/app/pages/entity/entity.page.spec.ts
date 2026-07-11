import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
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
import { of, Subject, throwError } from 'rxjs';
import { CONTENT_FORMAT, CORE_HEXMAP, EntityDetail, EntityType } from '@hexly/domain';
import { EntitiesClient, NudgeBusClient, ActiveWorld, TitleService, EVICTED, Watched } from '@hexly/web-core';
import { MockEntitiesClient, MockNudgeBusClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { EntitySession } from './services/entity-session';
import { GRID_STORE } from './services/grid-store.port';
import { HexMapStore } from '@hexly/web-map';
import { EntityNameResolver, CONTENT_EDITOR_SESSION } from '@hexly/content-editor';
import { noteDetail } from './components/entity-detail.fixtures';
import { EntityPage } from './entity.page';
import { EntityViewStore } from './services/entity-view-store';
import { CORE_VIEW_CONTENT } from '../../entity-types/view-definition';

/** Resolve AuthClient's boot `/auth/me` as anonymous so `whenStable()` settles. */
function flushAuth(http: HttpTestingController) {
  http
    .match('/api/auth/me')
    .forEach((req) => req.flush(null, { status: 401, statusText: 'Unauthorized' }));
}

// Hexmap with a populated Content body, to prove the Note view seeds it (#75).
const hexmapWithContent = (text: string): EntityDetail => ({
  id: 'm1',
  worldId: 'w1',
  name: 'The Reach of Aldermoor',
  types: [CORE_HEXMAP],
  tags: [],
  visibility: 'private',
  version: 1,
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  // Owner opener (ADR-0039): the `edit` Right keeps the map/editor writable.
  rights: ['read', 'edit', 'delete', 'set-visibility', 'manage'],
  document: {
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
  let entities: MockEntitiesClient;
  let bus: MockNudgeBusClient;
  let watched: Subject<Watched<EntityDetail>>;
  let navigate: ReturnType<typeof vi.spyOn>;

  const detail = (id: string, type: EntityType): EntityDetail =>
    type === 'note'
      ? noteDetail('Lady Mara')
      : { ...hexmapWithContent('The reach lies north.'), id, name: 'Aldermoor' };

  /** Configure the TestBed for `:id` without mounting yet, so a test can arm `entities` first. */
  async function configure(id: string, query: Record<string, string> = {}) {
    entities = new MockEntitiesClient();
    bus = new MockNudgeBusClient();
    // The store's live-follow is tested in its own spec; here the page drives the session off what
    // EntitiesClient.watch emits, so stub it with a Subject the test pushes into.
    watched = new Subject<Watched<EntityDetail>>();
    entities.watch.mockReturnValue(watched);
    await TestBed.configureTestingModule({
      imports: [EntityPage, provideTranslocoTesting()],
      providers: [
        EntitySession,
        { provide: CONTENT_EDITOR_SESSION, useExisting: EntitySession },
        { provide: GRID_STORE, useExisting: HexMapStore },
        EntityNameResolver,
        { provide: EntitiesClient, useValue: entities },
        { provide: NudgeBusClient, useValue: bus },
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id })),
            queryParamMap: of(convertToParamMap(query)),
            // ContentEditor reads the fragment for `[[Target#Heading]]` anchor scroll (ADR-0033).
            fragment: of(null),
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
  }

  function mount() {
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    // AuthClient's session resource fires on boot; not under test here.
    http.match('/api/auth/me');
    http.verify();
  });

  it('shows the Content body for a note', async () => {
    await configure('n1');
    entities.load.mockReturnValue(of(detail('n1', 'note')));
    const fixture = mount();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
  });

  it('shows the map editor for a hexmap', async () => {
    await configure('m1');
    entities.load.mockReturnValue(of(detail('m1', 'hexmap')));
    const fixture = mount();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
  });

  it('restores the active View from the ?view query param (#75, ADR-0048)', async () => {
    // A shared link with the full View id lands the hexmap on its Content view.
    await configure('m1', { view: CORE_VIEW_CONTENT });
    entities.load.mockReturnValue(of(detail('m1', 'hexmap')));
    const fixture = mount();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
  });

  it('titles the tab with the open Entity name (owned by the session, not the view)', async () => {
    await configure('m1');
    entities.load.mockReturnValue(of(detail('m1', 'hexmap')));
    const fixture = mount();
    fixture.detectChanges();
    flushAuth(http);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(TitleService).documentName()).toBe('Aldermoor');
  });

  it('blanks to an unavailable state when the followed Entity is evicted (ADR-0044)', async () => {
    await configure('n1');
    entities.load.mockReturnValue(of(detail('n1', 'note')));
    const fixture = mount();
    fixture.detectChanges();
    TestBed.tick(); // settle the reconciler's follow subscription

    // The server evicted this follower (private flip, revoked grant, or delete).
    watched.next(EVICTED);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-content-editor')).toBeNull();
    expect(el.querySelector('[data-testid="entity-unavailable"]')).not.toBeNull();
  });

  it('returns to the World’s library when the Entity fails to load', async () => {
    await configure('gone');
    entities.load.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    const fixture = mount();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities']);
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
        { provide: CONTENT_EDITOR_SESSION, useExisting: EntitySession },
        { provide: GRID_STORE, useExisting: HexMapStore },
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // AuthClient's session resource fires on boot; not under test here.
    http.match('/api/auth/me');
    http.verify();
  });

  it('arms the non-destructive Select tool by default', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

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

    const el = fixture.nativeElement as HTMLElement;
    // Canvas, strip, and rail present; right panel closed by default (ADR-0013, story 20).
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-tool-palette')).not.toBeNull();
    expect(el.querySelector('app-editor-rail')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
    expect(el.querySelector('app-regions-panel')).toBeNull();
  });

  /**
   * The right dock holds one panel and a rail of toggles (ADR-0013). The Outline and References
   * share the slot, so opening either closes the other — the reading column reflows once, never
   * twice, and neither panel can be orphaned behind the other.
   */
  it('swaps the dock between the Outline and References, never showing both', () => {
    TestBed.inject(EntitySession).adopt(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (testid: string) => {
      el.querySelector<HTMLButtonElement>(`[data-testid=${testid}]`)?.click();
      fixture.detectChanges();
    };

    // Both closed on boot.
    expect(el.querySelector('app-outline-panel')).toBeNull();
    expect(el.querySelector('app-references-panel')).toBeNull();

    click('outline-toggle');
    expect(el.querySelector('app-outline-panel')).not.toBeNull();

    click('references-toggle');
    expect(el.querySelector('app-outline-panel')).toBeNull();
    expect(el.querySelector('app-references-panel')).not.toBeNull();
    // Opening it reads the edge index; the Outline, derived from live Content, reads nothing.
    http
      .expectOne('/api/entities/n1/references')
      .flush({ references: [], referencedBy: [] });

    // A second click on the active toggle closes the dock, as it always did.
    click('references-toggle');
    expect(el.querySelector('app-references-panel')).toBeNull();
  });

  /**
   * Both panels are the same width and float over the same corner, so the reading column must
   * reflow for either. Reserving room only for the Outline lets the References panel sit on top
   * of the last inch of every line of prose.
   */
  it('reflows the reading column for whichever panel is open', () => {
    TestBed.inject(EntitySession).adopt(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const column = () => el.querySelector<HTMLElement>('[data-content-scroll]')!;
    const click = (testid: string) => {
      el.querySelector<HTMLButtonElement>(`[data-testid=${testid}]`)?.click();
      fixture.detectChanges();
    };

    // Closed: room for the floating toggles only.
    expect(column().style.paddingRight).toBe('3.5rem');

    click('outline-toggle');
    expect(column().style.paddingRight).toBe('20rem');

    click('references-toggle');
    http.expectOne('/api/entities/n1/references').flush({ references: [], referencedBy: [] });
    fixture.detectChanges();
    expect(column().style.paddingRight).toBe('20rem');

    click('references-toggle');
    expect(column().style.paddingRight).toBe('3.5rem');
  });

  it('shows the hex canvas in the Map view, not the Content editor', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('app-content-editor')).toBeNull();
  });

  it('swaps the canvas for the Content editor in the Note view, seeded with the map’s Content', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges(); // mounts on the grid (the empty route leaves the default map view)
    // Flip to the Content view after mount, as the header's toggle would.
    fixture.debugElement.injector.get(EntityViewStore).setView(CORE_VIEW_CONTENT);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // Content view: the editor takes the body, canvas gone.
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
    const surface = el.querySelector('[data-testid=note-content]') as HTMLElement;
    expect(surface.textContent).toContain('The reach lies north.');
  });

  it('opens the Regions panel from the closed default via the rail', () => {
    TestBed.inject(EntitySession).adopt(hexmapWithContent('The reach lies north.'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-regions-panel')).toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();

    (el.querySelector('[data-testid=rail-regions]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('app-regions-panel')).not.toBeNull();
    expect(el.querySelector('app-inspector')).toBeNull();
  });

  it('shows the open note’s name, with no map canvas', () => {
    TestBed.inject(EntitySession).adopt(noteDetail('Lady Mara'));
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lady Mara');
    // A note has no grid: the content view renders, never the map canvas.
    expect(el.querySelector('app-map-canvas')).toBeNull();
  });

  it('mounts the shared Content editor for a note, seeded with its stored Content', () => {
    TestBed.inject(EntitySession).adopt({
      ...noteDetail('Lady Mara'),
      document: {
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
