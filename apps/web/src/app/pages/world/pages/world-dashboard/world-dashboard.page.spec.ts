import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import {
  EntityDetail,
  EntityFacets,
  EntityPage,
  EntitySummary,
  EntityType,
  WorldDetail,
  WorldVerb,
} from '@hexly/domain';
import { EntitiesClient, WorldsClient, ActiveWorld } from '@hexly/web-core';
import { MockEntitiesClient, MockWorldsClient } from '@hexly/web-core/testing';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { WorldDashboardPage } from './world-dashboard.page';

function summary(id: string, name = id, type: EntityType = 'core.type.note', updatedAt = 1): EntitySummary {
  return {
    id,
    worldId: 'w1',
    name,
    types: [type],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt,
  };
}

const page = (items: EntitySummary[]): EntityPage => ({
  items,
  nextCursor: null,
});

function worldDetail(pinnedEntityIds: string[] = [], rights: WorldVerb[] = ['read', 'manage']): WorldDetail {
  return {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['ada'],
    kind: 'campaign',
    rights,
    entityCount: 0,
    pinnedEntityIds,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('WorldDashboard', () => {
  let entities: MockEntitiesClient;
  let worlds: MockWorldsClient;
  let world: WritableSignal<WorldDetail | null>;
  let activeWorldSet: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<WorldDashboardPage>;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    worlds = new MockWorldsClient();
    world = signal<WorldDetail | null>(worldDetail());
    activeWorldSet = vi.fn((w: WorldDetail | null) => world.set(w));
    await TestBed.configureTestingModule({
      imports: [WorldDashboardPage, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        provideRouter([]),
        { provide: EntitiesClient, useValue: entities },
        { provide: WorldsClient, useValue: worlds },
        {
          provide: ActiveWorld,
          useValue: {
            worldId: signal('w1'),
            name: signal('Aldermoor'),
            world,
            set: activeWorldSet,
            // Delegates to the client like the real service, so the pin flow tests still
            // assert the ids reaching setPins; the toast-on-error path is covered in active-world.spec.
            commitPins: vi.fn((ids: string[]) =>
              worlds.setPins('w1', ids).subscribe({
                next: (d) => (activeWorldSet as (w: WorldDetail) => void)(d),
              }),
            ),
          },
        },
      ],
    }).compileComponents();
  });

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel);

  /**
   * Render the Dashboard. `recents` is the unfiltered (updatedAt desc) list;
   * `maps` is the `type=hexmap` list; `facets` the at-a-glance counts.
   */
  function render(
    opts: {
      recents?: EntitySummary[];
      maps?: EntitySummary[];
      facets?: EntityFacets;
      /** Access-filtered summaries the `list({ ids })` pin-resolve returns (any order). */
      pinResolve?: EntitySummary[];
    } = {},
  ) {
    entities.list.mockImplementation((o) => {
      if (o?.ids) return of(page(opts.pinResolve ?? []));
      return of(page(o?.type?.includes('core.type.hex-map') ? (opts.maps ?? []) : (opts.recents ?? [])));
    });
    entities.facets.mockReturnValue(of(opts.facets ?? { type: [], tag: [], visibility: [], fields: [] }));
    fixture = TestBed.createComponent(WorldDashboardPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the Owner-curated pins, in pin order, dropping ids the reader can’t resolve', () => {
    world.set(worldDetail(['p2', 'gone', 'p1']));
    const el = render({
      recents: [summary('e1')],
      // The access-filtered read returns the reachable pins in server order;
      // 'gone' (deleted or private-to-others) simply isn't in the response.
      pinResolve: [summary('p1', 'Riverbend'), summary('p2', 'North Reach')],
    });

    // Resolved through the entity read path with the pin id set (the client sizes the
    // page to the id count — covered in entities.client.spec).
    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ ids: ['p2', 'gone', 'p1'] }));
    // Rendered in pinnedEntityIds order (p2 before p1), with 'gone' absent.
    const pins = Array.from(el.querySelectorAll('[data-testid^=pin-]'));
    expect(pins.map((p) => p.getAttribute('data-testid'))).toEqual(['pin-p2', 'pin-p1']);
    expect($(el, '[data-testid=pin-p2]')?.textContent).toContain('North Reach');
  });

  it('shows pins read-only to a non-Owner: no add, remove, or reorder controls', () => {
    world.set(worldDetail(['p1'], ['read']));
    const el = render({
      recents: [summary('e1')],
      pinResolve: [summary('p1', 'Riverbend')],
    });

    // The pinned card is there…
    expect($(el, '[data-testid=pin-p1]')).not.toBeNull();
    // …but none of the Owner-only curation affordances.
    expect($(el, '[data-testid=add-pin]')).toBeNull();
    expect($(el, '[data-testid=remove-pin-p1]')).toBeNull();
    expect($(el, '[data-testid=move-pin-up-p1]')).toBeNull();
  });

  it('lets an Owner pin an Entity, PATCHing the replacement array and re-pinning the World', () => {
    world.set(worldDetail(['p1']));
    worlds.setPins.mockReturnValue(of(worldDetail(['p1', 'e1'])));
    const el = render({
      recents: [summary('e1', 'New pin')],
      pinResolve: [summary('p1', 'Riverbend')],
    });

    ($(el, '[data-testid=add-pin]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // The picker searches via list({q}) — the recents stub is its option source here.
    ($(el, '[data-testid=pin-picker-option-e1]') as HTMLButtonElement).click();

    // The picker is scoped to the active World so a pin can't be a foreign-World Entity.
    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ q: '', worldId: 'w1' }));
    // Appended to the existing set, sent wholesale.
    expect(worlds.setPins).toHaveBeenCalledWith('w1', ['p1', 'e1']);
    // The returned Detail re-pins the active World so the pins re-resolve.
    expect(activeWorldSet).toHaveBeenCalledWith(worldDetail(['p1', 'e1']));
  });

  /**
   * A pin is stored verbatim and resolved by an unscoped `ids` read, so it is the World's own content
   * rather than a link out of it — none of the surfaces ADR-0080 widens. A mounted Shelf's Entity must
   * not become pinnable to a World's Dashboard.
   */
  it('keeps the pin picker same-World, offering nothing this World merely Mounts', () => {
    world.set(worldDetail(['p1']));
    const el = render({
      recents: [summary('e1', 'New pin')],
      pinResolve: [summary('p1', 'Riverbend')],
    });

    ($(el, '[data-testid=add-pin]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1', container: ['w1'] }));
    // The Container facet is how a widened read annotates itself; a sealed one has nothing to narrow.
    expect($(el, '[data-testid=pin-picker-containers]')).toBeNull();
  });

  it('does not re-pin an Entity that is already pinned', () => {
    world.set(worldDetail(['p1']));
    const el = render({
      recents: [summary('p1', 'Riverbend')],
      pinResolve: [summary('p1', 'Riverbend')],
    });

    ($(el, '[data-testid=add-pin]') as HTMLButtonElement).click();
    fixture.detectChanges();
    ($(el, '[data-testid=pin-picker-option-p1]') as HTMLButtonElement).click();

    expect(worlds.setPins).not.toHaveBeenCalled();
  });

  it('lets an Owner unpin an Entity, PATCHing the set without it', () => {
    world.set(worldDetail(['p1', 'p2']));
    worlds.setPins.mockReturnValue(of(worldDetail(['p2'])));
    const el = render({
      recents: [summary('e1')],
      pinResolve: [summary('p1', 'Riverbend'), summary('p2', 'North Reach')],
    });

    ($(el, '[data-testid=remove-pin-p1]') as HTMLButtonElement).click();

    expect(worlds.setPins).toHaveBeenCalledWith('w1', ['p2']);
  });

  it('lets an Owner reorder a pin, PATCHing the new order', () => {
    world.set(worldDetail(['p1', 'p2']));
    worlds.setPins.mockReturnValue(of(worldDetail(['p2', 'p1'])));
    const el = render({
      recents: [summary('e1')],
      pinResolve: [summary('p1', 'Riverbend'), summary('p2', 'North Reach')],
    });

    // Move the second pin up past the first.
    ($(el, '[data-testid=move-pin-up-p2]') as HTMLButtonElement).click();

    expect(worlds.setPins).toHaveBeenCalledWith('w1', ['p2', 'p1']);
  });

  it('renders the most-recently-edited Entities as recents', () => {
    const el = render({
      recents: [summary('e1', 'Aldermoor'), summary('e2', 'Whisperwood')],
    });

    expect($(el, '[data-testid=recent-e1]')?.textContent).toContain('Aldermoor');
    expect($(el, '[data-testid=recent-e2]')?.textContent).toContain('Whisperwood');
  });

  it('renders the World’s Hex Maps, fetched with a type=hexmap filter', () => {
    const el = render({
      recents: [summary('n1', 'A note')],
      maps: [summary('m1', 'The Reach', 'core.type.hex-map')],
    });

    // The maps list is a distinct, filtered read.
    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1', type: ['core.type.hex-map'] }));
    expect($(el, '[data-testid=map-m1]')?.textContent).toContain('The Reach');
  });

  it('renders at-a-glance Type counts from the facets endpoint', () => {
    const el = render({
      recents: [summary('e1')],
      facets: {
        type: [
          { value: 'core.type.note', count: 3 },
          { value: 'core.type.hex-map', count: 1 },
        ],
        tag: [],
        visibility: [],
        fields: [],
      },
    });

    expect(entities.facets).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1' }));
    expect($(el, '[data-testid="count-type-core.type.note"]')?.textContent).toContain('3');
    expect($(el, '[data-testid="count-type-core.type.hex-map"]')?.textContent).toContain('1');
  });

  it('links to the full Entity Browser', () => {
    const el = render({ recents: [summary('e1')] });

    expect(($(el, '[data-testid=browse-all]') as HTMLAnchorElement).getAttribute('href')).toBe('/w/w1/entities');
  });

  it('offers the shared New split button from the header of a populated World (#195)', () => {
    const el = render({ recents: [summary('e1')] });

    expect($(el, '[data-testid=new-default-entity]')).not.toBeNull();
    expect($(el, '[data-testid=new-entity-menu]')).not.toBeNull();
  });

  it('offers the shared New split button from the empty state of an empty World (#195)', () => {
    const el = render({ recents: [], maps: [] });

    expect($(el, '[data-testid=dashboard-empty]')).not.toBeNull();
    // The one create affordance: the default Type by default, every enabled Type behind the arrowhead.
    expect($(el, '[data-testid=new-default-entity]')).not.toBeNull();
    expect($(el, '[data-testid=new-entity-menu]')).not.toBeNull();
    // No recents section when there's nothing to recent.
    expect($(el, '[data-testid=browse-all]')).toBeNull();
  });

  it('creates the first Note from the empty state and opens it', () => {
    const el = render({ recents: [], maps: [] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    entities.create.mockReturnValue(of(summary('new1', 'Untitled note') as unknown as EntityDetail));

    ($(el, '[data-testid=new-default-entity]') as HTMLButtonElement).click();

    expect(entities.create).toHaveBeenCalledWith(expect.any(String), ['core.type.note'], 'w1');
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'new1']);
  });
});
