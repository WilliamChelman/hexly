import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { ClientConfigStore, EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, mockClientConfigStore } from '@hexly/web-core/testing';
import { InlineEntityCreator } from './inline-entity-creator';

const minted = { id: 'n2', name: 'Zorblax' } as EntityDetail;

function createCreator(config: ClientConfigStore): { creator: InlineEntityCreator; client: MockEntitiesClient } {
  const client = new MockEntitiesClient();
  client.create.mockReturnValue(of(minted));
  TestBed.configureTestingModule({
    providers: [
      { provide: EntitiesClient, useValue: client },
      { provide: ClientConfigStore, useValue: config },
    ],
  });
  return { creator: TestBed.inject(InlineEntityCreator), client };
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
});
