import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { EntityPage, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { MockEntitiesClient } from '../../../core/testing/entities-client.mock';
import { EntityQuickOpen } from './entity-quick-open';

function entity(id: string, name: string): EntitySummary {
  return {
    id,
    name,
    ownerId: 'u1',
    worldId: 'w1',
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function page(items: EntitySummary[]): EntityPage {
  return { items, nextCursor: null };
}

describe('EntityQuickOpen', () => {
  let client: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;

  function setup() {
    client = new MockEntitiesClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: client },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return TestBed.inject(EntityQuickOpen);
  }

  it('answers the empty (Quick Open) prefix', () => {
    expect(setup().prefix).toBe('');
  });

  it('searches the server globally — by q, not scoped to a World (ADR-0025)', async () => {
    const provider = setup();
    client.list.mockReturnValue(of(page([entity('e1', 'Bramblewick')])));

    const commands = await firstValueFrom(provider.search('bram'));

    expect(client.list).toHaveBeenCalledWith({ q: 'bram' });
    expect(commands.map((c) => c.title)).toEqual(['Bramblewick']);
  });

  it('navigates to the Entity when its Command runs', async () => {
    const provider = setup();
    client.list.mockReturnValue(of(page([entity('e1', 'Bramblewick')])));

    const [command] = await firstValueFrom(provider.search('bram'));
    command.run();

    expect(navigate).toHaveBeenCalledWith(['/entities', 'e1']);
  });

  it('returns nothing without hitting the server for a blank query', async () => {
    const provider = setup();

    const commands = await firstValueFrom(provider.search('   '));

    expect(commands).toEqual([]);
    expect(client.list).not.toHaveBeenCalled();
  });
});
