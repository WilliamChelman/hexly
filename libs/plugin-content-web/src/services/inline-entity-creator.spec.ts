import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { ClientConfigStore, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, mockClientConfigStore } from '@hexly/web-core/testing';
import { DETAILED_ENTITY_CREATOR, DetailedEntitySeed } from '@hexly/web-entity';
import { InlineEntityCreator } from './inline-entity-creator';

const minted = { id: 'n2', name: 'Zorblax' } as EntityDetail;

/** Stands in for the app's create dialog: records its seed and answers with whatever the test pins. */
function stubDialog(result: EntityDetail | null) {
  return vi.fn((_seed: DetailedEntitySeed) => of(result));
}

function createCreator(
  config: ClientConfigStore,
  openDetails = stubDialog(minted),
): { creator: InlineEntityCreator; client: MockEntitiesClient; openDetails: ReturnType<typeof stubDialog> } {
  const client = new MockEntitiesClient();
  client.create.mockReturnValue(of(minted));
  TestBed.configureTestingModule({
    providers: [
      { provide: EntitiesClient, useValue: client },
      { provide: ClientConfigStore, useValue: config },
      { provide: DETAILED_ENTITY_CREATOR, useValue: openDetails },
    ],
  });
  return { creator: TestBed.inject(InlineEntityCreator), client, openDetails };
}

describe('InlineEntityCreator', () => {
  it('mints under the configured inline Type and Tag, in the World it was named from', () => {
    const { creator, client } = createCreator(
      mockClientConfigStore({
        defaultType: signal('core.type.hex-map'),
        inlineType: signal('world.type.rumour'),
        inlineTag: signal('untriaged'),
      }),
    );

    creator.create('Zorblax', 'w9').subscribe();

    // Not `defaultType`: the New button's Type answers a different question (ADR-0073).
    expect(client.create).toHaveBeenCalledWith('Zorblax', ['world.type.rumour'], 'w9', undefined, ['untriaged']);
  });

  it('mints with no Tag when the Instance names none — nothing is imposed on the author', () => {
    const { creator, client } = createCreator(mockClientConfigStore({ inlineType: signal('core.type.note') }));

    creator.create('Zorblax', 'w9').subscribe();

    expect(client.create).toHaveBeenCalledWith('Zorblax', ['core.type.note'], 'w9', undefined, undefined);
  });

  it('falls back to core.type.note when the config never landed, rather than refusing the gesture', () => {
    const { creator, client } = createCreator(mockClientConfigStore());

    creator.create('Zorblax', 'w9').subscribe();

    expect(client.create).toHaveBeenCalledWith('Zorblax', ['core.type.note'], 'w9', undefined, undefined);
  });

  it('seeds the details dialog with the same name, Type, Tag and World the fast path would mint under', () => {
    const { creator, openDetails } = createCreator(
      mockClientConfigStore({ inlineType: signal('world.type.rumour'), inlineTag: signal('untriaged') }),
    );

    creator.createWithDetails('Zorblax', 'w9').subscribe();

    expect(openDetails).toHaveBeenCalledWith({
      name: 'Zorblax',
      worldId: 'w9',
      type: 'world.type.rumour',
      tags: ['untriaged'],
    });
  });

  it('writes nothing itself on the details path — the dialog owns that create', () => {
    const { creator, client } = createCreator(mockClientConfigStore({ inlineType: signal('core.type.note') }));

    creator.createWithDetails('Zorblax', 'w9').subscribe();

    expect(client.create).not.toHaveBeenCalled();
  });

  it('passes a cancelled dialog through as null, so the caller leaves the typed text alone', async () => {
    const { creator } = createCreator(mockClientConfigStore(), stubDialog(null));

    await expect(firstValueFrom(creator.createWithDetails('Zorblax', 'w9'))).resolves.toBeNull();
  });
});
