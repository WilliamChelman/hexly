import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { ENTITY_LIST_MAX_LIMIT, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { MockEntitiesClient } from '../../../core/testing/entities-client.mock';
import { EntityQuickOpen } from './entity-quick-open';

function entity(id: string, name: string, worldId = 'w1'): EntitySummary {
  return {
    id,
    name,
    worldId,
    ownerId: 'u1',
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('EntityQuickOpen', () => {
  let entitiesClient: MockEntitiesClient;
  let navigate: ReturnType<typeof vi.spyOn>;
  let provider: EntityQuickOpen;

  beforeEach(() => {
    entitiesClient = new MockEntitiesClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EntitiesClient, useValue: entitiesClient },
      ],
    });
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    provider = TestBed.inject(EntityQuickOpen);
  });

  it('answers the empty (Quick Open) prefix', () => {
    expect(provider.prefix).toBe('');
  });

  it('searches globally — not scoped to any World', async () => {
    entitiesClient.list.mockReturnValue(
      of({ items: [entity('e1', 'Aldermoor')], nextCursor: null }),
    );

    const commands = await firstValueFrom(provider.search('alder'));

    expect(entitiesClient.list).toHaveBeenCalledWith({
      q: 'alder',
      limit: ENTITY_LIST_MAX_LIMIT,
    });
    expect(commands).toEqual([
      expect.objectContaining({ id: 'e1', label: 'Aldermoor' }),
    ]);
  });

  it('skips the request for a blank query', async () => {
    const commands = await firstValueFrom(provider.search('  '));

    expect(entitiesClient.list).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });

  it('navigates to the matched Entity\'s own World when picked', async () => {
    entitiesClient.list.mockReturnValue(
      of({ items: [entity('e1', 'Aldermoor', 'w9')], nextCursor: null }),
    );

    const [command] = await firstValueFrom(provider.search('alder'));
    command.run();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w9', 'entities', 'e1']);
  });
});
