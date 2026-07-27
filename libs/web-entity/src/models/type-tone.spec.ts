import { describe, expect, it } from 'vitest';
import { CATEGORICAL_TONES } from '@hexly/web-ui';
import { typeColorToken, typeTone } from './type-tone';

/**
 * The categorical tone an Entity Type wears (ADR-0075). Two properties are the contract: the same type
 * id always lands on the same tone — no registration order, no plugin load order, no run-to-run
 * drift — and a type that says which tone it wants gets it.
 */
describe('typeTone', () => {
  it('gives a type with no declared tone one of the eight categoricals', () => {
    for (const id of ['core.type.note', 'core.type.hex-map', 'dnd.type.monster', 'world.type.faction']) {
      expect(CATEGORICAL_TONES).toContain(typeTone({ id }));
    }
  });

  it('never derives the accent, which is the through-line and not a category', () => {
    expect(CATEGORICAL_TONES).not.toContain('accent');
  });

  it('gives the same type the same tone every time it is asked', () => {
    const ids = ['core.type.note', 'draw-steel.type.monster', 'world.type.deity'];
    for (const id of ids) {
      const [first, ...rest] = Array.from({ length: 5 }, () => typeTone({ id }));
      expect(rest.every((tone) => tone === first)).toBe(true);
    }
  });

  /**
   * The tones are pinned rather than merely self-consistent: "the same type gets the same tone across
   * runs and across plugins" is only true if changing the hash is a failing test rather than a silent
   * recolouring of every World's chips.
   */
  it('pins the tone of each shipped type id, so the hash cannot change unnoticed', () => {
    expect({
      'core.type.note': typeTone({ id: 'core.type.note' }),
      'core.type.hex-map': typeTone({ id: 'core.type.hex-map' }),
      'core.type.board': typeTone({ id: 'core.type.board' }),
      'core.type.asset': typeTone({ id: 'core.type.asset' }),
      'dnd.type.monster': typeTone({ id: 'dnd.type.monster' }),
      'draw-steel.type.monster': typeTone({ id: 'draw-steel.type.monster' }),
    }).toEqual({
      'core.type.note': 'tone-5',
      'core.type.hex-map': 'tone-3',
      'core.type.board': 'tone-1',
      'core.type.asset': 'tone-2',
      'dnd.type.monster': 'tone-2',
      'draw-steel.type.monster': 'tone-1',
    });
  });

  /**
   * Two plugins naming their type the same thing past the namespace is the collision the id-wide hash
   * has to survive — a digest that reads only the tail would hand them the same tone.
   */
  it('separates two plugins whose type ids differ only in their namespace', () => {
    expect(typeTone({ id: 'dnd.type.monster' })).not.toBe(typeTone({ id: 'draw-steel.type.monster' }));
  });

  it('spreads a World of user-defined types across the set rather than bunching them', () => {
    const ids = Array.from({ length: 64 }, (_, i) => `world.type.${i}`);
    expect(new Set(ids.map((id) => typeTone({ id }))).size).toBe(CATEGORICAL_TONES.length);
  });

  it('lets a type declare its tone, which wins over the derived one', () => {
    expect(typeTone({ id: 'core.type.note' })).toBe('tone-5');
    expect(typeTone({ id: 'core.type.note', tone: 'tone-7' })).toBe('tone-7');
  });

  it('lets a type declare the accent, which is not in the derived set', () => {
    expect(typeTone({ id: 'core.type.hex-map', tone: 'accent' })).toBe('accent');
  });
});

describe('typeColorToken', () => {
  it('paints a categorical type with its own tone, so its node and its chips cannot disagree', () => {
    expect(typeColorToken({ id: 'core.type.note' })).toBe('--color-tone-5');
    expect(typeColorToken({ id: 'core.type.note', tone: 'tone-7' })).toBe('--color-tone-7');
  });

  it('lets a type opt out of the categorical set by naming a token outright', () => {
    expect(typeColorToken({ id: 'core.type.note', graphColorToken: '--color-ink-muted' })).toBe('--color-ink-muted');
  });
});
