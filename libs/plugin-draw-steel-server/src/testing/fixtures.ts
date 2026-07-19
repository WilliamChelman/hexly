/**
 * Tiny committed fixtures (Ajax + one Goblin) that drive the importer's tests offline (ADR-0061). They
 * are trimmed real actor `_source` documents — enough of the shape for the transform to read, with the
 * ability/trait item arrays dropped — and both keep an `img` so a test can prove the transform never
 * copies art into the Entity Document. Only a handful of these are committed; the bulk pack is never
 * vendored.
 */

/** Ajax the Invincible — a level-11 solo, exercising the full scalar spine (level 11, EV 156, stamina 700). */
export const AJAX_MONSTER_FIXTURE = {
  name: 'Ajax the Invincible',
  type: 'npc',
  _id: 'DZKCzrvXRPBUjUJf',
  img: 'systems/draw-steel/assets/roles/solo.webp',
  system: {
    stamina: { value: 700, max: 700, temporary: 0 },
    characteristics: {
      might: { value: 5 },
      agility: { value: 4 },
      reason: { value: 5 },
      intuition: { value: 5 },
      presence: { value: 4 },
    },
    combat: { save: { threshold: 6, bonus: '' }, size: { value: 1, letter: 'L' }, stability: 2, turns: 3 },
    movement: { value: 7, types: ['fly', 'walk'], hover: true, disengage: 1 },
    damage: {
      immunities: {
        all: 0,
        acid: 0,
        cold: 0,
        corruption: 0,
        fire: 0,
        holy: 0,
        lightning: 0,
        poison: 0,
        psychic: 0,
        sonic: 0,
      },
      weaknesses: {
        all: 0,
        acid: 0,
        cold: 0,
        corruption: 0,
        fire: 0,
        holy: 0,
        lightning: 0,
        poison: 0,
        psychic: 0,
        sonic: 0,
      },
    },
    monster: { freeStrike: 11, keywords: ['humanoid', 'human'], level: 11, role: 'solo', organization: 'solo' },
    ev: 156,
    source: { book: 'Monsters', page: '33', license: 'Draw Steel Creator License' },
  },
} as const;

/** Goblin Warrior — a level-1 harrier with negative characteristics, so the transform's `0`-is-a-value guard is exercised. */
export const GOBLIN_MONSTER_FIXTURE = {
  name: 'Goblin Warrior',
  type: 'npc',
  _id: '6SR8siFeC5lWUzoO',
  img: 'systems/draw-steel/assets/roles/harrier.webp',
  system: {
    stamina: { value: 15, max: 15, temporary: 0 },
    characteristics: {
      might: { value: -2 },
      agility: { value: 2 },
      reason: { value: 0 },
      intuition: { value: 0 },
      presence: { value: -1 },
    },
    combat: { save: { threshold: 6, bonus: '' }, size: { value: 1, letter: 'S' }, stability: 0, turns: 1 },
    movement: { value: 6, types: ['walk', 'climb'], hover: false, disengage: 1 },
    damage: {
      immunities: {
        all: 0,
        acid: 0,
        cold: 0,
        corruption: 0,
        fire: 0,
        holy: 0,
        lightning: 0,
        poison: 0,
        psychic: 0,
        sonic: 0,
      },
      weaknesses: {
        all: 0,
        acid: 0,
        cold: 0,
        corruption: 0,
        fire: 0,
        holy: 0,
        lightning: 0,
        poison: 0,
        psychic: 0,
        sonic: 0,
      },
    },
    monster: { freeStrike: 1, keywords: ['humanoid', 'goblin'], level: 1, role: 'harrier', organization: 'horde' },
    ev: 3,
  },
} as const;

/** The committed fixtures the fixture-backed fetch port serves. */
export const MONSTER_FIXTURES: readonly unknown[] = [AJAX_MONSTER_FIXTURE, GOBLIN_MONSTER_FIXTURE];
