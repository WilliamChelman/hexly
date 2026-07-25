import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { EntityQuickOpen } from './entity-quick-open';

function entity(id: string, name: string, worldId = 'w1'): EntitySummary {
  return {
    id,
    name,
    worldId,
    types: ['core.type.note'],
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
      providers: [provideRouter([]), { provide: EntitiesClient, useValue: entitiesClient }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    provider = TestBed.inject(EntityQuickOpen);
  });

  it('answers the empty (Quick Open) prefix', () => {
    expect(provider.prefix).toBe('');
  });

  it('searches globally — not scoped to any World — opting into thumbnails and hidden types', async () => {
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor')], nextCursor: null }));

    const commands = await firstValueFrom(provider.search('alder'));

    // includeHidden: Quick Open matches an Asset by name like any Entity (ADR-0065), unlike a browse —
    // the server ranks those matches last, so they never crowd the top of the palette.
    expect(entitiesClient.list).toHaveBeenCalledWith({
      q: 'alder',
      limit: 20,
      includeHidden: true,
      thumbnails: true,
    });
    expect(commands).toEqual([expect.objectContaining({ id: 'e1', label: 'Aldermoor' })]);
  });

  it("threads the summary's resolved thumbnailUrl onto the command", async () => {
    entitiesClient.list.mockReturnValue(
      of({ items: [{ ...entity('e1', 'Aldermoor'), thumbnailUrl: '/api/assets/a1/thumb' }], nextCursor: null }),
    );

    const [command] = await firstValueFrom(provider.search('alder'));

    expect(command.thumbnailUrl).toBe('/api/assets/a1/thumb');
  });

  it('leaves thumbnailUrl undefined when the summary carries none', async () => {
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor')], nextCursor: null }));

    const [command] = await firstValueFrom(provider.search('alder'));

    expect(command.thumbnailUrl).toBeUndefined();
  });

  it('skips the request for a blank query', async () => {
    const commands = await firstValueFrom(provider.search('  '));

    expect(entitiesClient.list).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });

  it("navigates to the matched Entity's own World when picked", async () => {
    entitiesClient.list.mockReturnValue(of({ items: [entity('e1', 'Aldermoor', 'w9')], nextCursor: null }));

    const [command] = await firstValueFrom(provider.search('alder'));
    command.run();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w9', 'entities', 'e1']);
  });
});
