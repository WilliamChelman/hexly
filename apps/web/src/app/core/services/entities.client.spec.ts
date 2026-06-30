import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { coordKey, emptyContent, EntityBody } from '@hexly/domain';
import {
  FakeStore,
  provideFakeTrailbaseRecords,
} from '../testing/fake-records-client';
import { EntitiesClient } from './entities.client';

const emptyHexmapBody: EntityBody = {
  type: 'hexmap',
  content: emptyContent(),
  hexes: {},
  regions: [],
  labels: [],
};

/** Wire-shaped `entities` row as a TrailBase Record API returns it. */
function entityRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    owner_id: 'u1',
    world_id: 'w1',
    is_home: 0,
    name: 'Aldermoor',
    type: 'hexmap',
    tags: '[]',
    visibility: 'private',
    version: 1,
    document: JSON.stringify(emptyHexmapBody),
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

describe('EntitiesClient', () => {
  let client: EntitiesClient;
  let store: FakeStore;

  beforeEach(() => {
    const fake = provideFakeTrailbaseRecords();
    store = fake.store;
    TestBed.configureTestingModule({ providers: [fake.provider] });
    client = TestBed.inject(EntitiesClient);
  });

  it('lists entities as the page envelope, parsing wire rows into summaries', async () => {
    store.seed('entities', [entityRow({ id: 'e1', tags: '["deity"]' })]);

    const page = await firstValueFrom(client.list());

    expect(page.items).toEqual([
      expect.objectContaining({ id: 'e1', worldId: 'w1', type: 'hexmap', tags: ['deity'] }),
    ]);
    // A short page (fewer than the limit) is the final page.
    expect(page.nextCursor).toBeNull();
  });

  it('carries a nextCursor when a full page is returned', async () => {
    store.seed(
      'entities',
      Array.from({ length: 3 }, (_, i) => entityRow({ id: `e${i}` })),
    );

    const page = await firstValueFrom(client.list({ limit: 3 }));

    expect(page.items.length).toBe(3);
    expect(page.nextCursor).toBe('CURSOR');
  });

  it('filters by world, type, and name query', async () => {
    store.seed('entities', [
      entityRow({ id: 'e1', world_id: 'w1', type: 'note', name: 'Riverford' }),
      entityRow({ id: 'e2', world_id: 'w1', type: 'hexmap', name: 'The Reach' }),
      entityRow({ id: 'e3', world_id: 'w9', type: 'note', name: 'Elsewhere' }),
    ]);

    const byWorld = await firstValueFrom(client.list({ worldId: 'w1' }));
    expect(byWorld.items.map((e) => e.id).sort()).toEqual(['e1', 'e2']);

    const byType = await firstValueFrom(client.list({ worldId: 'w1', type: 'note' }));
    expect(byType.items.map((e) => e.id)).toEqual(['e1']);

    const byQuery = await firstValueFrom(client.list({ q: 'each' }));
    expect(byQuery.items.map((e) => e.id)).toEqual(['e2']);
  });

  it('drops the Home Entity when excludeHome is set', async () => {
    store.seed('entities', [
      entityRow({ id: 'home', is_home: 1 }),
      entityRow({ id: 'note', is_home: 0 }),
    ]);

    const page = await firstValueFrom(client.list({ excludeHome: true }));

    expect(page.items.map((e) => e.id)).toEqual(['note']);
  });

  it('creates an entity with an empty body and returns the loaded detail', async () => {
    const created = await firstValueFrom(client.create('Lady Mara', 'note', 'w1'));

    expect(created).toEqual(
      expect.objectContaining({ name: 'Lady Mara', type: 'note', worldId: 'w1' }),
    );
    // The new row carries a serialized empty note body the editor can open.
    const row = store.rows('entities')[0];
    expect(JSON.parse(row['document'] as string)).toEqual(
      expect.objectContaining({ type: 'note' }),
    );
  });

  it('loads an entity by id, parsing its document and Home flag', async () => {
    const painted: EntityBody = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };
    store.seed('entities', [entityRow({ id: 'e1', is_home: 1, document: JSON.stringify(painted) })]);

    const loaded = await firstValueFrom(client.load('e1'));

    expect(loaded.document).toEqual(painted);
    expect(loaded.isHome).toBe(true);
  });

  it('renames an entity (metadata only) and re-reads it', async () => {
    store.seed('entities', [entityRow({ id: 'e1', name: 'Aldermoor' })]);

    const renamed = await firstValueFrom(client.rename('e1', 'The Whisperwood'));

    expect(renamed.name).toBe('The Whisperwood');
    expect(store.rows('entities')[0]['name']).toBe('The Whisperwood');
  });

  it('deletes an entity by id', async () => {
    store.seed('entities', [entityRow({ id: 'e1' })]);

    await firstValueFrom(client.delete('e1'));

    expect(store.rows('entities')).toEqual([]);
  });

  it('saves the body last-write-wins, bumping the version, and reports saved', async () => {
    store.seed('entities', [entityRow({ id: 'e1', version: 1 })]);
    const painted: EntityBody = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };

    const outcome = await firstValueFrom(
      client.save('e1', painted, 1, ['deity', 'ruined'], []),
    );

    expect(outcome.status).toBe('saved');
    const row = store.rows('entities')[0];
    expect(row['version']).toBe(2);
    expect(JSON.parse(row['document'] as string)).toEqual(painted);
    expect(JSON.parse(row['tags'] as string)).toEqual(['deity', 'ruined']);
  });
});
