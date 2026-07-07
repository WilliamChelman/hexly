import { healWorldSegment, idFromSegment, segment, slugify } from './pretty-id';

const ID = '274900e5-d3ab-42c8-839b-58d701dcba66';
const WORLD = 'c6b611f6-f54f-4ee8-8b62-c62ecc8484c1';

describe('pretty-id', () => {
  it('round-trips a UUID losslessly through segment/idFromSegment', () => {
    const ids = [
      '274900e5-d3ab-42c8-839b-58d701dcba66',
      'c6b611f6-f54f-4ee8-8b62-c62ecc8484c1',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ];
    for (const id of ids) {
      expect(idFromSegment(segment(id, 'Some Name'))).toBe(id);
    }
  });

  it('prepends a name-derived slug to the code', () => {
    expect(segment(ID, 'The Whisperwood')).toMatch(/^the-whisperwood-[0-9A-Za-z]+$/);
  });

  it('folds French accents in the slug', () => {
    expect(slugify('Forêt des Murmures')).toBe('foret-des-murmures');
    expect(slugify('Château Noir')).toBe('chateau-noir');
  });

  it('lowercases, collapses non-alphanumerics, trims, and caps length', () => {
    expect(slugify('  Hello, World!!  ')).toBe('hello-world');
    expect(slugify('a'.repeat(80)).length).toBe(60);
    expect(slugify('The Kingdom of Avalon & Beyond')).toBe('the-kingdom-of-avalon-beyond');
  });

  it('emits a bare code (no leading dash) for an empty or unsluggable name', () => {
    const bare = segment(ID);
    expect(bare).not.toContain('-');
    expect(segment(ID, '🐉✨')).toBe(bare);
    expect(idFromSegment(bare)).toBe(ID);
  });

  it('ignores a stale or wrong slug prefix', () => {
    const code = segment(ID); // bare code
    expect(idFromSegment(`totally-wrong-name-${code}`)).toBe(ID);
  });

  it('passes a legacy full-UUID segment through unchanged', () => {
    expect(idFromSegment(ID)).toBe(ID);
  });

  describe('healWorldSegment', () => {
    it('rewrites the World segment and preserves the rest of the path and query', () => {
      expect(healWorldSegment(`/w/${WORLD}/entities?q=orc`, WORLD, 'Avalon')).toBe(
        `/w/${segment(WORLD, 'Avalon')}/entities?q=orc`,
      );
    });

    it('leaves other segments (and a stale entity slug) untouched', () => {
      const healed = healWorldSegment(
        `/w/${segment(WORLD)}/entities/old-slug-${segment(ID)}`,
        WORLD,
        'Avalon',
      );
      expect(healed).toBe(
        `/w/${segment(WORLD, 'Avalon')}/entities/old-slug-${segment(ID)}`,
      );
    });

    it('returns null when the segment is already canonical', () => {
      expect(
        healWorldSegment(`/w/${segment(WORLD, 'Avalon')}/entities`, WORLD, 'Avalon'),
      ).toBeNull();
    });

    it('returns null for a non-World-scoped URL', () => {
      expect(healWorldSegment('/settings', WORLD, 'Avalon')).toBeNull();
    });
  });
});
