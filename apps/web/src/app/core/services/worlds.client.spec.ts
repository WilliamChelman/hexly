import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  FakeStore,
  installWorldHomeTrigger,
  provideFakeTrailbaseRecords,
} from '../testing/fake-records-client';
import { WorldsClient } from './worlds.client';

/** Wire-shaped `worlds` row as a TrailBase Record API returns it. */
function worldRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'w1',
    name: 'Aldermoor',
    owner_id: 'u1',
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

describe('WorldsClient', () => {
  let client: WorldsClient;
  let store: FakeStore;

  beforeEach(() => {
    const fake = provideFakeTrailbaseRecords();
    store = fake.store;
    TestBed.configureTestingModule({ providers: [fake.provider] });
    client = TestBed.inject(WorldsClient);
  });

  it('lists the caller’s worlds as summaries, newest first', async () => {
    store.seed('worlds', [
      worldRow({ id: 'w1', name: 'Aldermoor', updated_at: 1 }),
      worldRow({ id: 'w2', name: 'Whisperwood', updated_at: 2 }),
    ]);

    const listed = await firstValueFrom(client.list());

    expect(listed).toEqual([
      { id: 'w2', name: 'Whisperwood', ownerId: 'u1', createdAt: 1, updatedAt: 2 },
      { id: 'w1', name: 'Aldermoor', ownerId: 'u1', createdAt: 1, updatedAt: 1 },
    ]);
  });

  it('creates a world and composes its Home Entity id + count (the trigger mints the Home)', async () => {
    installWorldHomeTrigger(store);

    const created = await firstValueFrom(client.create('Aldermoor'));

    expect(created.name).toBe('Aldermoor');
    expect(created.entityCount).toBe(1);
    // The composed Home id points at the Entity the trigger minted for this World.
    const home = store.rows('entities').find((e) => e['world_id'] === created.id);
    expect(created.homeEntityId).toBe(home?.['id']);
  });

  it('gets one world as a detail carrying its Home id and entity count', async () => {
    store.seed('worlds', [worldRow({ id: 'w1' })]);
    store.seed('entities', [
      { id: 'home', world_id: 'w1', is_home: 1, name: 'Aldermoor' },
      { id: 'note', world_id: 'w1', is_home: 0, name: 'Lady Mara' },
    ]);

    const got = await firstValueFrom(client.get('w1'));

    expect(got.homeEntityId).toBe('home');
    expect(got.entityCount).toBe(2);
    expect(got.name).toBe('Aldermoor');
  });

  it('renames a world and re-reads the updated detail', async () => {
    store.seed('worlds', [worldRow({ id: 'w1', name: 'Aldermoor' })]);
    store.seed('entities', [{ id: 'home', world_id: 'w1', is_home: 1 }]);

    const renamed = await firstValueFrom(client.rename('w1', 'The Reach'));

    expect(renamed.name).toBe('The Reach');
    expect(store.rows('worlds')[0]['name']).toBe('The Reach');
  });

  it('deletes a world by id', async () => {
    store.seed('worlds', [worldRow({ id: 'w1' })]);

    await firstValueFrom(client.delete('w1'));

    expect(store.rows('worlds')).toEqual([]);
  });
});
