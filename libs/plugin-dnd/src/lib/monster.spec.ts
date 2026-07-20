import { defineType, resolveEffectiveFields, structuredDataTypeSet, validateFields } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { DND_MONSTER, DND_MONSTER_TYPE } from './monster';
import { DND_STAT_BLOCK_FIELD, DND_STAT_BLOCK_FIELD_ID, DND_STAT_BLOCK_KEY, STAT_BLOCK_DATA_TYPE } from './stat-block';

describe('defineType', () => {
  it('rejects a malformed plugin at declaration time, not at runtime', () => {
    // A bare id (no namespace) would collide with a future plugin's.
    expect(() => defineType({ id: 'monster', label: 'Monster' })).toThrow();
    // A `fieldRef` is a Field id, not a bare key — a malformed reference is a plugin bug, caught here.
    expect(() => defineType({ id: 'dnd.type.beast', label: 'Beast', fieldRefs: ['cr'] })).toThrow();
  });
});

describe('dnd.type.monster', () => {
  it('is namespaced, and references its prose and stat-block Fields — nothing else (ADR-0055)', () => {
    expect(DND_MONSTER).toBe('dnd.type.monster');
    // The thirteen scalar stat Fields retired: a monster is now one grouped stat block plus its prose.
    expect(DND_MONSTER_TYPE.fieldRefs).toEqual([CONTENT_FIELD.id, DND_STAT_BLOCK_FIELD_ID]);
  });

  it('resolves the stat-block Field through the shared types[] → Fields path both sides ride', () => {
    const byId = new Map([DND_STAT_BLOCK_FIELD, CONTENT_FIELD].map((field) => [field.id, field]));
    const fields = resolveEffectiveFields({
      types: [DND_MONSTER],
      doc: {},
      fieldResolver: (id) => byId.get(id),
      typeFieldRefs: () => DND_MONSTER_TYPE.fieldRefs,
    });

    expect(fields.map((field) => field.id)).toContain(DND_STAT_BLOCK_KEY);

    // The forward-only gate resolves the stat block against its own valueSchema (ADR-0050/0055): a
    // well-typed block passes; a mistyped stat (a CR that is a string a block prints, not a number) fails.
    const dataTypes = structuredDataTypeSet([STAT_BLOCK_DATA_TYPE]);
    expect(
      validateFields(fields, { 'dnd.field.stat-block': { challenge_rating: 5, size: 'Large' } }, dataTypes).ok,
    ).toBe(true);
    expect(validateFields(fields, { 'dnd.field.stat-block': { challenge_rating: '5' } }, dataTypes).ok).toBe(false);
    // An absent block is tolerated — the stat-block Field is not required (it opens empty, ADR-0054).
    expect(validateFields(fields, {}, dataTypes).ok).toBe(true);
  });
});
