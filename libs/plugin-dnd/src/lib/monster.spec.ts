import { defineType, NO_STRUCTURED_DATA_TYPES, resolveFields, validateFields } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import {
  abilityModifier,
  DND_ABILITY_KEYS,
  DND_CHALLENGE_KEY,
  DND_DEFENCE_KEYS,
  DND_IDENTITY_KEYS,
  DND_MONSTER,
  DND_MONSTER_TYPE,
  formatModifier,
} from './monster';

describe('defineType', () => {
  it('rejects a malformed plugin at declaration time, not at runtime', () => {
    // A bare id (no namespace) would collide with a future plugin's.
    expect(() => defineType({ id: 'monster', label: 'Monster' })).toThrow();
    // Two Fields typing one EntityDocument key is a plugin bug: the key can only mean one thing.
    expect(() =>
      defineType({
        id: 'dnd.beast',
        label: 'Beast',
        fields: [
          { key: 'cr', label: 'CR', dataType: { kind: 'number' }, required: false, facetable: false },
          { key: 'cr', label: 'Challenge', dataType: { kind: 'string' }, required: false, facetable: false },
        ],
      }),
    ).toThrow();
  });
});

describe('dnd.monster', () => {
  it('is namespaced, and declares challenge_rating as a required number', () => {
    expect(DND_MONSTER).toBe('dnd.monster');

    const cr = DND_MONSTER_TYPE.fields.find((field) => field.key === DND_CHALLENGE_KEY);
    expect(cr).toMatchObject({ dataType: { kind: 'number' }, required: true, facetable: true });
  });

  it('resolves through the shared types[] → Fields path both sides ride', () => {
    const resolver = (id: string) => (id === DND_MONSTER ? DND_MONSTER_TYPE.fields : undefined);
    const fields = resolveFields(resolver, [DND_MONSTER]);

    expect(fields.map((field) => field.key)).toContain(DND_CHALLENGE_KEY);
    // The forward-only gate: a monster without its required Field is rejected on an active typed edit…
    expect(validateFields(fields, { size: 'Large' }, NO_STRUCTURED_DATA_TYPES).ok).toBe(false);
    // …and passes once it's supplied, with the rest of the stat block optional.
    expect(validateFields(fields, { challenge_rating: 5 }, NO_STRUCTURED_DATA_TYPES).ok).toBe(true);
    // A wrong data-type is rejected too — a CR is a number, not the string a stat block prints.
    expect(validateFields(fields, { challenge_rating: '5' }, NO_STRUCTURED_DATA_TYPES).ok).toBe(false);
  });

  it('exposes exactly the facetable Fields the Browser unfolds under the type filter', () => {
    const facetable = DND_MONSTER_TYPE.fields.filter((field) => field.facetable).map((field) => field.key);
    expect(facetable).toEqual(['size', 'creature_type', 'challenge_rating']);
  });

  /**
   * The stat-block view skips any key the schema doesn't declare (forward-only), so a Field renamed
   * here would vanish from the block in silence unless the two lists are pinned together.
   */
  it('declares a Field for every key the stat block prints, and prints every stat Field it declares', () => {
    // The canonical prose Field is declared beside the stats (ADR-0051) but rendered by the content
    // editor, not the stat block — so it is the one declared Field the block does not print.
    const declared = new Set(
      DND_MONSTER_TYPE.fields.map((field) => field.key).filter((key) => key !== CONTENT_FIELD.key),
    );
    const printed = [...DND_IDENTITY_KEYS, ...DND_DEFENCE_KEYS, ...DND_ABILITY_KEYS, DND_CHALLENGE_KEY];

    expect(printed.filter((key) => !declared.has(key))).toEqual([]);
    // The block is a monster's only authoring surface, so an unprinted Field would be unsettable.
    expect([...declared].filter((key) => !printed.includes(key))).toEqual([]);
  });
});

describe('abilityModifier', () => {
  it('derives the printed modifier from a raw score', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
  });

  it('is blank for an absent or ill-typed score, never a bogus modifier (forward-only tolerance)', () => {
    expect(abilityModifier(undefined)).toBeNull();
    expect(abilityModifier('strong')).toBeNull();
    expect(abilityModifier(Number.NaN)).toBeNull();
  });

  it('prints a modifier signed, as a stat block does', () => {
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-1)).toBe('-1');
  });
});
