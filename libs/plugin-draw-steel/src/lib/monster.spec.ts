import { resolveEffectiveFields, structuredDataTypeSet, validateFields } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { DS_MONSTER, DS_MONSTER_TYPE } from './monster';
import { DS_STAT_BLOCK_FIELD, DS_STAT_BLOCK_FIELD_ID, DS_STAT_BLOCK_KEY, STAT_BLOCK_DATA_TYPE } from './stat-block';

describe('draw-steel.type.monster', () => {
  it('is namespaced, and references its prose and stat-block Fields — nothing else (ADR-0054)', () => {
    expect(DS_MONSTER).toBe('draw-steel.type.monster');
    expect(DS_MONSTER_TYPE.fieldRefs).toEqual([CONTENT_FIELD.id, DS_STAT_BLOCK_FIELD_ID]);
  });

  it('resolves the stat-block Field through the shared types[] → Fields path both sides ride', () => {
    const byId = new Map([DS_STAT_BLOCK_FIELD, CONTENT_FIELD].map((field) => [field.id, field]));
    const fields = resolveEffectiveFields({
      types: [DS_MONSTER],
      doc: {},
      fieldResolver: (id) => byId.get(id),
      typeFieldRefs: () => DS_MONSTER_TYPE.fieldRefs,
    });

    expect(fields.map((field) => field.id)).toContain(DS_STAT_BLOCK_KEY);

    // The forward-only gate resolves the block against its own valueSchema (ADR-0050/0055): a well-typed
    // block passes; a mistyped stat (a might that is a string, not a number) fails.
    const dataTypes = structuredDataTypeSet([STAT_BLOCK_DATA_TYPE]);
    expect(validateFields(fields, { 'draw-steel.field.stat-block': { level: 3, role: 'brute' } }, dataTypes).ok).toBe(
      true,
    );
    expect(validateFields(fields, { 'draw-steel.field.stat-block': { might: 'strong' } }, dataTypes).ok).toBe(false);
    // An absent block is tolerated — the stat-block Field is not required (it opens empty, ADR-0054).
    expect(validateFields(fields, {}, dataTypes).ok).toBe(true);
  });
});
