import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { EntityDetail, EntityType, LOCAL_GRAPH_MAX_DEPTH, LocalGraph } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { FakeEntitySession, provideEntityTypesTesting, provideFakeEntitySession } from '../testing';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';
import { GraphCanvasComponent } from '../graph/graph-canvas.component';
import { LocalGraphStore } from '../services/local-graph-store';
import { LocalGraphPanelComponent } from './local-graph-panel.component';

/**
 * The Local Graph Panel (ADR-0072) — a universal Dock Panel (ADR-0067) drawing the open Entity's
 * neighbourhood. The drawing itself is WebGL and renders nothing here; what these specs pin is the panel's
 * own contract: what it asks the server for, what it claims before the read lands, and the two controls
 * (the persisted depth, the ephemeral decor reveal).
 */
describe('LocalGraphPanel', () => {
  const NOTE = 'core.type.note' as EntityType;

  /** A minimal note detail — the store reads only the Entity's id/seq off `current` (ADR-0045). */
  const noteDetail = (name: string, id = 'n1'): EntityDetail => ({
    id,
    worldId: 'w1',
    name,
    types: [NOTE],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document: {},
  });

  /** A neighbourhood centred on `n1`; edges are `'source>target'`, a trailing `!` marking a Decor Link. */
  const graph = (nodes: string[], edges: string[] = [], depth = 1): LocalGraph => ({
    center: 'n1',
    depth,
    nodes: nodes.map((id) => ({ id, name: id.toUpperCase(), types: [NOTE] })),
    edges: edges.map((edge) => {
      const decor = edge.endsWith('!');
      const [source, target] = (decor ? edge.slice(0, -1) : edge).split('>');
      return { source, target, descriptor: null, decor };
    }),
  });

  let session: FakeEntitySession;
  let http: HttpTestingController;

  beforeEach(async () => {
    // The depth is a persisted per-user preference, so one spec's choice would otherwise be the next's default.
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LocalGraphPanelComponent, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        provideFakeEntitySession(),
        provideEntityTypesTesting([]),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(FakeEntitySession);
    http = TestBed.inject(HttpTestingController);
  });

  /**
   * The store is Panel-scoped, so it fetches for the open Entity the moment the Panel mounts; the
   * unflushed request stays pending, and `adopt` seeds the drawing without racing it — as the References
   * panel's fixture does.
   */
  function mount(seed?: LocalGraph): {
    fixture: ComponentFixture<LocalGraphPanelComponent>;
    el: HTMLElement;
    store: LocalGraphStore;
  } {
    session.loadDetail(noteDetail('Ealdred'));
    const fixture = TestBed.createComponent(LocalGraphPanelComponent);
    const store = fixture.debugElement.injector.get(LocalGraphStore);
    if (seed) store.adopt('n1', seed);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  /** The default read is one hop, and the drawing knows which Entity it is about. */
  it('asks for one hop by default and draws the neighbourhood around the open Entity', () => {
    const { fixture, el } = mount(graph(['n1', 'mira'], ['n1>mira']));

    expect(http.expectOne('/api/entities/n1/graph?depth=1').request.method).toBe('GET');
    expect(el.querySelector('[data-testid=graph-canvas]')).not.toBeNull();
    expect(el.querySelector('[data-testid=local-graph-counts]')?.textContent).toContain('2 entities');
    // The centre is handed to the renderer, which draws it larger than its degree alone would earn it.
    expect(fixture.debugElement.query(By.directive(GraphCanvasComponent)).componentInstance.center()).toBe('n1');
  });

  /** The depth is a *server* bound (ADR-0072), so choosing another one refetches rather than filtering. */
  it('refetches at the chosen depth, and holds no drawing until it lands', () => {
    const { fixture, el } = mount(graph(['n1', 'mira'], ['n1>mira']));
    http.expectOne('/api/entities/n1/graph?depth=1');

    el.querySelector<HTMLButtonElement>('[data-testid=local-graph-depth-2]')?.click();
    fixture.detectChanges();

    expect(http.expectOne('/api/entities/n1/graph?depth=2').request.method).toBe('GET');
    // The one-hop graph would misreport the control's reading, so it is withheld rather than redrawn.
    expect(el.querySelector('[data-testid=local-graph-counts]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid=local-graph-depth-2]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  /** Every hop the read allows is one click away, and the current one reads off the control. */
  it('offers one control per hop up to the read’s ceiling', () => {
    const { el } = mount();

    expect(el.querySelectorAll('[data-testid^=local-graph-depth-]')).toHaveLength(LOCAL_GRAPH_MAX_DEPTH);
    expect(el.querySelector<HTMLButtonElement>('[data-testid=local-graph-depth-1]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  /** How far out a reader likes to look is a habit, not a peek: it survives closing the Panel. */
  it('remembers the chosen depth for the next time the Panel opens', () => {
    const first = mount(graph(['n1']));
    http.expectOne('/api/entities/n1/graph?depth=1');
    first.el.querySelector<HTMLButtonElement>('[data-testid=local-graph-depth-3]')?.click();
    first.fixture.detectChanges();
    http.expectOne('/api/entities/n1/graph?depth=3');
    first.fixture.destroy();

    mount();

    expect(http.expectOne('/api/entities/n1/graph?depth=3').request.method).toBe('GET');
  });

  /** "Links to nothing" is a claim about the edge index, not about the fetch: it must not appear before the read. */
  it('claims nothing until the graph has landed', () => {
    const { fixture, el, store } = mount();

    expect(el.querySelector('[data-testid=local-graph-isolated]')).toBeNull();

    store.adopt('n1', graph(['n1']));
    fixture.detectChanges();

    expect(el.querySelector('[data-testid=local-graph-isolated]')).not.toBeNull();
  });

  /**
   * A Decor Link (ADR-0069) is hidden by default and revealed on demand — and because the read never walks
   * decor, revealing it can only add a line, never a node.
   */
  it('hides a Decor Link behind an ephemeral reveal', () => {
    const { fixture, el } = mount(graph(['n1', 'mira', 'crest'], ['n1>mira', 'n1>crest!']));

    const counts = () => el.querySelector('[data-testid=local-graph-counts]')?.textContent ?? '';
    expect(counts()).toContain('3 entities');
    expect(counts()).toContain('1 links');

    const toggle = el.querySelector<HTMLButtonElement>('[data-testid=local-graph-decor-toggle]');
    expect(toggle).not.toBeNull();
    toggle?.click();
    fixture.detectChanges();

    expect(counts()).toContain('3 entities');
    expect(counts()).toContain('2 links');
  });

  /** No decor in the neighbourhood → no dead control. */
  it('offers no reveal control when nothing in the neighbourhood is decor', () => {
    const { el } = mount(graph(['n1', 'mira'], ['n1>mira']));

    expect(el.querySelector('[data-testid=local-graph-decor-toggle]')).toBeNull();
  });

  /**
   * The Panel stays open across `:id` changes, so a neighbourhood held for the Entity just closed must
   * never be drawn against the one just opened.
   */
  it('drops a held graph when a different Entity is opened', () => {
    const { el } = mount(graph(['n1', 'mira'], ['n1>mira']));
    expect(el.querySelector('[data-testid=local-graph-counts]')).not.toBeNull();

    session.loadDetail(noteDetail('Mira', 'n2'));
    TestBed.tick();

    // Blanks to *nothing* — not to "links to nothing", which would be a claim about an unfetched Entity.
    expect(el.querySelector('[data-testid=local-graph-counts]')).toBeNull();
    expect(el.querySelector('[data-testid=local-graph-isolated]')).toBeNull();
  });
});
