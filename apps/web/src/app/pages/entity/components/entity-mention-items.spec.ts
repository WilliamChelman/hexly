import { EntitySummary } from '@hexly/domain';
import { filterEntities } from './entity-mention-items';

function summary(partial: Partial<EntitySummary> & Pick<EntitySummary, 'id' | 'name'>): EntitySummary {
  return {
    ownerId: 'owner',
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const entities: EntitySummary[] = [
  summary({ id: 'self', name: 'This Very Note' }),
  summary({ id: 'n1', name: 'Avalon' }),
  summary({ id: 'm1', name: 'Avalon Region Map', type: 'hexmap' }),
  summary({ id: 'n2', name: 'Camelot' }),
];

describe('filterEntities', () => {
  it('returns every entity for an empty query (unfiltered by type or self)', () => {
    // Notes, hexmaps, and the current note are all valid targets (issue #95).
    expect(filterEntities(entities, '')).toEqual(entities);
  });

  it('narrows by name as the user types, case-insensitively across types', () => {
    const result = filterEntities(entities, 'avalon');
    // The note and the hexmap both match — type is not a filter.
    expect(result.map((e) => e.id)).toEqual(['n1', 'm1']);
  });
});
