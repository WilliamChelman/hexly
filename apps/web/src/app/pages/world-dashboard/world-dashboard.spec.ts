import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import {
  EntityDetail,
  EntityFacets,
  EntityPage,
  EntitySummary,
  EntityType,
} from '@hexly/domain';
import { EntitiesClient } from '../../core/services/entities.client';
import { MockEntitiesClient } from '../../core/testing/entities-client.mock';
import { ActiveWorld } from '../../core/services/active-world';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { WorldDashboard } from './world-dashboard';

function summary(
  id: string,
  name = id,
  type: EntityType = 'note',
  updatedAt = 1,
): EntitySummary {
  return {
    id,
    worldId: 'w1',
    name,
    type,
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt,
  };
}

const page = (items: EntitySummary[]): EntityPage => ({ items, nextCursor: null });

describe('WorldDashboard', () => {
  let entities: MockEntitiesClient;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [WorldDashboard, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: entities },
        {
          provide: ActiveWorld,
          useValue: { worldId: signal('w1'), name: signal('Aldermoor') },
        },
      ],
    }).compileComponents();
  });

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel);

  /**
   * Render the Dashboard. `recents` is the unfiltered (updatedAt desc) list;
   * `maps` is the `type=hexmap` list; `facets` the at-a-glance counts.
   */
  function render(opts: {
    recents?: EntitySummary[];
    maps?: EntitySummary[];
    facets?: EntityFacets;
  } = {}) {
    entities.list.mockImplementation((o) =>
      of(page(o?.type?.includes('hexmap') ? (opts.maps ?? []) : (opts.recents ?? []))),
    );
    entities.facets.mockReturnValue(
      of(opts.facets ?? { type: [], tag: [], visibility: [] }),
    );
    const fixture = TestBed.createComponent(WorldDashboard);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

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
      maps: [summary('m1', 'The Reach', 'hexmap')],
    });

    // The maps list is a distinct, filtered read.
    expect(entities.list).toHaveBeenCalledWith(
      expect.objectContaining({ worldId: 'w1', type: ['hexmap'] }),
    );
    expect($(el, '[data-testid=map-m1]')?.textContent).toContain('The Reach');
  });

  it('renders at-a-glance Type counts from the facets endpoint', () => {
    const el = render({
      recents: [summary('e1')],
      facets: {
        type: [
          { value: 'note', count: 3 },
          { value: 'hexmap', count: 1 },
        ],
        tag: [],
        visibility: [],
      },
    });

    expect(entities.facets).toHaveBeenCalledWith(
      expect.objectContaining({ worldId: 'w1' }),
    );
    expect($(el, '[data-testid=count-type-note]')?.textContent).toContain('3');
    expect($(el, '[data-testid=count-type-hexmap]')?.textContent).toContain('1');
  });

  it('links to the full Entity Browser', () => {
    const el = render({ recents: [summary('e1')] });

    expect(
      ($(el, '[data-testid=browse-all]') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/w/w1/entities');
  });

  it('shows an empty state prompting Note or Map creation for an empty World', () => {
    const el = render({ recents: [], maps: [] });

    expect($(el, '[data-testid=dashboard-empty]')).not.toBeNull();
    expect($(el, '[data-testid=create-note]')).not.toBeNull();
    expect($(el, '[data-testid=create-map]')).not.toBeNull();
    // No recents section when there's nothing to recent.
    expect($(el, '[data-testid=browse-all]')).toBeNull();
  });

  it('creates the first Note from the empty state and opens it', () => {
    const el = render({ recents: [], maps: [] });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    entities.create.mockReturnValue(
      of(summary('new1', 'Untitled note') as unknown as EntityDetail),
    );

    ($(el, '[data-testid=create-note]') as HTMLButtonElement).click();

    expect(entities.create).toHaveBeenCalledWith(
      expect.any(String),
      'note',
      'w1',
    );
    expect(navigate).toHaveBeenCalledWith(['/w', 'w1', 'entities', 'new1']);
  });
});
