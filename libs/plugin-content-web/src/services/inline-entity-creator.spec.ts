import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of } from 'rxjs';
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

  it('joins a mint of the same name still in flight, so two mentions converge on one Entity (ADR-0073)', () => {
    const { creator, client } = createCreator(mockClientConfigStore());
    const write = new Subject<EntityDetail>();
    client.create.mockReturnValue(write);

    const first: EntityDetail[] = [];
    const second: EntityDetail[] = [];
    creator.create('Zorblax', 'w9').subscribe((entity) => first.push(entity));
    // Typed again before the first write came back — the picker still offers Create, because the
    // search cache only forgets its miss once the mint lands.
    creator.create('zorblax ', 'w9').subscribe((entity) => second.push(entity));
    write.next(minted);
    write.complete();

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(first).toEqual([minted]);
    expect(second).toEqual([minted]);
  });

  it('mints a second, distinct Entity once the first has landed — Create beside the matches still creates', () => {
    const { creator, client } = createCreator(mockClientConfigStore());

    creator.create('Zorblax', 'w9').subscribe();
    creator.create('Zorblax', 'w9').subscribe();

    expect(client.create).toHaveBeenCalledTimes(2);
  });

  it('keeps a mint per World: the same name in two Worlds is two Entities', () => {
    const { creator, client } = createCreator(mockClientConfigStore());
    client.create.mockReturnValue(new Subject<EntityDetail>());

    creator.create('Zorblax', 'w9').subscribe();
    creator.create('Zorblax', 'w8').subscribe();

    expect(client.create).toHaveBeenCalledTimes(2);
  });

  it('lets the next mention retry after a failed write rather than replaying the failure', () => {
    const { creator, client } = createCreator(mockClientConfigStore());
    const write = new Subject<EntityDetail>();
    client.create.mockReturnValueOnce(write).mockReturnValueOnce(of(minted));

    creator.create('Zorblax', 'w9').subscribe({ error: () => undefined });
    write.error(new Error('500'));
    creator.create('Zorblax', 'w9').subscribe();

    expect(client.create).toHaveBeenCalledTimes(2);
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
