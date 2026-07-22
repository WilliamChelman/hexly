import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injector } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { CORE_HEXMAP, HEX_GRID_FIELD } from '@hexly/plugin-hexmap';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { EntitiesClient, ActiveWorld } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import {
  CORE_VIEW_MAP,
  ENTITY_RENDER_CONTEXT,
  ENTITY_SESSION,
  ENTITY_TYPES,
  EntityDock,
  viewInstanceKey,
} from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT, providePluginContent, EntityNameResolver } from '@hexly/plugin-content/web';
import { EntitySession } from '../services/entity-session';
import { EntityViewStore } from '../services/entity-view-store';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { ViewRegistry } from '../../../entity-types/view-registry';
import { CORE_VIEW_DEFINITIONS } from '../views/core-views';
import { noteDetail } from './note-detail.fixtures';
import {
  DEFAULT_ENTITY_RENDER_CONTEXT,
  EntityRenderContext,
  EntityViewOutletComponent,
} from './entity-view-outlet.component';

// A readable hexmap, so a pinned Map View resolves against a real afforded set.
const hexmapDetail = (): EntityDetail => ({
  ...noteDetail('The Reach of Aldermoor'),
  id: 'm1',
  types: [CORE_HEXMAP],
  document: { 'core.field.grid': { hexes: {}, regions: [], labels: [] } },
});

// The Seam C contract (#264): resolve-and-render, card degradation, dangling placeholder.
describe('EntityViewOutlet', () => {
  let http: HttpTestingController;
  let entities: MockEntitiesClient;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [EntityViewOutletComponent, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        { provide: ENTITY_TYPES, useExisting: TypeRegistry },
        // Page-scoped in the app (provided on EntityPage); provided here since the spec mounts the
        // outlet alone, and it reads the active View off this store.
        EntityViewStore,
        // Page-scoped too (ADR-0067): the Map View's HexMapStore claims its slot on selection, so a
        // mounted Map View needs the Dock in its injector chain.
        EntityDock,
        EntityNameResolver,
        { provide: EntitiesClient, useValue: entities },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');
    http = TestBed.inject(HttpTestingController);
    // EntityPage registers the core Views in the running app; the outlet spec mounts it alone, so seed
    // the generic Field view (the always-present fallback) here. Plugin views ride providePlugin*.
    const views = TestBed.inject(ViewRegistry);
    for (const def of CORE_VIEW_DEFINITIONS) views.register(def);
  });

  afterEach(() => {
    // AuthClient's session resource fires on boot; not under test here.
    http.match('/api/auth/me');
    http.verify();
  });

  /** Mount the outlet on a target id, with an optional pinned View and render context. */
  function mount(
    detail: EntityDetail,
    opts: { viewInstance?: { viewId: string; fieldKey?: string }; renderContext?: EntityRenderContext } = {},
  ): ComponentFixture<EntityViewOutletComponent> {
    entities.load.mockReturnValue(of(detail));
    const fixture = TestBed.createComponent(EntityViewOutletComponent);
    fixture.componentRef.setInput('entityId', detail.id);
    if (opts.viewInstance) fixture.componentRef.setInput('viewInstance', opts.viewInstance);
    fixture.componentRef.setInput('renderContext', opts.renderContext ?? DEFAULT_ENTITY_RENDER_CONTEXT);
    fixture.detectChanges();
    return fixture;
  }

  it('resolves the target by id and renders its chosen View chrome-free', async () => {
    const fixture = mount(noteDetail('Lady Mara'));
    // The content View is the content plugin's, fetched on activation rather than named (ADR-0051).
    await TestBed.inject(ViewRegistry).fetch(CORE_VIEW_RICH_CONTENT);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // The View body renders — and no page chrome (no header/toggle) around it.
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    expect(el.querySelector('app-entity-header')).toBeNull();
    expect(el.querySelector('[data-testid="entity-view-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="entity-view-dangling"]')).toBeNull();
  });

  it('degrades to the card preview on a cycle (target already an ancestor)', () => {
    const fixture = mount(noteDetail('Lady Mara'), {
      renderContext: { ancestorIds: ['n1'], depth: 0, maxDepth: 3 },
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="entity-view-card"]')).not.toBeNull();
    // Name shows on the card; the View body does not mount, so recursion stops here.
    expect(el.querySelector('[data-testid="entity-view-card-name"]')?.textContent).toContain('Lady Mara');
    expect(el.querySelector('app-content-editor')).toBeNull();
  });

  it('degrades to the card preview at the maximum render depth', () => {
    const fixture = mount(noteDetail('Lady Mara'), {
      renderContext: { ancestorIds: [], depth: 3, maxDepth: 3 },
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="entity-view-card"]')).not.toBeNull();
    expect(el.querySelector('app-content-editor')).toBeNull();
  });

  it('degrades to the card preview when the pinned View is no longer afforded', () => {
    // A note affords only its Content view: a pinned Map View (its grid Field gone / plugin off) can't
    // render, so the outlet degrades rather than silently swapping to another View.
    const fixture = mount(noteDetail('Lady Mara'), {
      viewInstance: { viewId: CORE_VIEW_MAP, fieldKey: HEX_GRID_FIELD.id },
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="entity-view-card"]')).not.toBeNull();
    expect(el.querySelector('app-content-editor')).toBeNull();
    expect(el.querySelector('app-map-canvas')).toBeNull();
  });

  it('renders the pinned View when the target affords it', async () => {
    const fixture = mount(hexmapDetail(), {
      viewInstance: { viewId: CORE_VIEW_MAP, fieldKey: HEX_GRID_FIELD.id },
    });
    await TestBed.inject(ViewRegistry).fetch(CORE_VIEW_MAP);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-map-canvas')).not.toBeNull();
    expect(el.querySelector('[data-testid="entity-view-card"]')).toBeNull();
  });

  it('renders the dangling placeholder for an unreadable target, leaking nothing', () => {
    entities.load.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const fixture = TestBed.createComponent(EntityViewOutletComponent);
    fixture.componentRef.setInput('entityId', 'secret');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="entity-view-dangling"]')).not.toBeNull();
    // Never the target's substance: no View body, no card, no name.
    expect(el.querySelector('app-content-editor')).toBeNull();
    expect(el.querySelector('[data-testid="entity-view-card"]')).toBeNull();
  });

  it('renders the dangling placeholder for a deleted target (404)', () => {
    entities.load.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const fixture = TestBed.createComponent(EntityViewOutletComponent);
    fixture.componentRef.setInput('entityId', 'gone');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="entity-view-dangling"]')).not.toBeNull();
  });

  it('hands the running View’s own injector out for the Dock to host View-contributed Panels (ADR-0067, #294)', async () => {
    // The active View is created manually so its injector escapes to the Dock; capture what the outlet emits.
    let captured: Injector | null | undefined;
    entities.load.mockReturnValue(of(noteDetail('Lady Mara')));
    const fixture = TestBed.createComponent(EntityViewOutletComponent);
    fixture.componentInstance.viewInjectorChange.subscribe((i) => (captured = i));
    fixture.componentRef.setInput('entityId', 'n1');
    fixture.detectChanges();
    await TestBed.inject(ViewRegistry).fetch(CORE_VIEW_RICH_CONTENT);
    fixture.detectChanges();

    // A real injector, and the running View's own — a child of the outlet's, so it resolves the render
    // context the outlet mints (and, in later tickets, the View's own View-scoped providers).
    expect(captured).toBeTruthy();
    expect(captured?.get(ENTITY_RENDER_CONTEXT)).toBe(DEFAULT_ENTITY_RENDER_CONTEXT);
  });

  it('hands out no injector when it degrades to the card — the View body never mounts (ADR-0062)', () => {
    let captured: Injector | null | undefined;
    entities.load.mockReturnValue(of(noteDetail('Lady Mara')));
    const fixture = TestBed.createComponent(EntityViewOutletComponent);
    fixture.componentInstance.viewInjectorChange.subscribe((i) => (captured = i));
    fixture.componentRef.setInput('entityId', 'n1');
    // A cycle degrades to the card, so no View is instantiated and no injector is offered.
    fixture.componentRef.setInput('renderContext', { ancestorIds: ['n1'], depth: 0, maxDepth: 3 });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="entity-view-card"]')).not.toBeNull();
    expect(captured).toBeNull();
  });

  it('the pinned View key keeps the codec round-trip the header/URL rely on', () => {
    // Guards the seam the outlet drives the store through: a Field-bound View keys to id:field.
    expect(viewInstanceKey({ viewId: CORE_VIEW_MAP, fieldKey: HEX_GRID_FIELD.id })).toBe(
      `${CORE_VIEW_MAP}:${HEX_GRID_FIELD.id}`,
    );
  });
});
