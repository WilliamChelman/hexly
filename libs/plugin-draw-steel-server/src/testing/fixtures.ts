/**
 * Tiny committed fixtures (Ajax + one Goblin) that drive the importer's tests offline (ADR-0061). They
 * are trimmed real actor `_source` documents — enough of the shape for the transform to read, keeping the
 * `feature` items (the trait source, #258) but dropping the far larger `ability` item arrays — and both
 * keep an `img` so a test can prove the transform never copies art into the Entity Document. Both also keep
 * an empty `biography`, so a test can prove an empty biography yields no `core.content`. Only a handful of
 * these are committed; the bulk pack is never vendored.
 */

/** Ajax the Invincible — a level-11 solo, exercising the full scalar spine (level 11, EV 156, stamina 700). */
export const AJAX_MONSTER_FIXTURE = {
  name: 'Ajax the Invincible',
  type: 'npc',
  _id: 'DZKCzrvXRPBUjUJf',
  img: 'systems/draw-steel/assets/roles/solo.webp',
  // Three real `feature` items → `traits[]` (#258); the `Ajax` trait embeds a labelled damage enricher and
  // `I'm Not Done Yet.` a label-less `[[/apply bleeding]]`, so the converter is exercised through the fixture.
  items: [
    {
      name: 'Ajax',
      type: 'feature',
      system: {
        description: {
          value:
            "<p><strong>Ajax Turns: </strong>Ajax takes up to three turns each round. He can't take turns consecutively. Additionally, he can use three triggered actions in a round while he isn't dazed.</p><p><strong>End Effect: </strong>At the end of each of his turns, Ajax can take [[/damage 20]]{20 damage} to end up to two effects on him that can be ended by a saving throw. This damage can't be reduced in any way.</p>",
          director: '',
        },
      },
    },
    {
      name: "I'm Not Done Yet.",
      type: 'feature',
      system: {
        description: {
          value:
            '<p>Ajax dies only when his Stamina reaches −350. While his Stamina is below 0, Ajax is [[/apply bleeding]], he can choose any two options from his Tactical Stance trait each round, and the Director gains 2 additional Malice per round.</p>',
          director: '',
        },
      },
    },
    {
      name: 'Tactical Stance',
      type: 'feature',
      system: {
        description: {
          value:
            '<p>At the start of each round, Ajax chooses a new stance from one of the following options and gains its benefits:</p><h4>Insurgent</h4><p>Ajax automatically treats his initial power roll as a 17.</p>',
          director: 'Only one stance may be active at a time.',
        },
      },
    },
    // An `ability` item is present in the real actor; the transform never reads it this pass (#258).
    { name: 'Blade of the Gol King', type: 'ability', system: {} },
  ],
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
    // Empty in the real actor — so this fixture proves an empty biography yields no `core.content` (#258).
    biography: { value: '<p></p>', director: '', languages: [] },
    // No condition immunities in the real Ajax; the `statuses.immunities` set is the source when present (#258).
    statuses: { immunities: [] },
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
  items: [
    {
      name: 'Crafty',
      type: 'feature',
      system: {
        description: {
          value: '<p>The Goblin Warrior doesnʼt provoke opportunity attacks by moving.</p>',
          director: '',
        },
      },
    },
  ],
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
    biography: { value: '', director: '', languages: [] },
    statuses: { immunities: [] },
    monster: { freeStrike: 1, keywords: ['humanoid', 'goblin'], level: 1, role: 'harrier', organization: 'horde' },
    ev: 3,
  },
} as const;

/** The committed fixtures the fixture-backed fetch port serves. */
export const MONSTER_FIXTURES: readonly unknown[] = [AJAX_MONSTER_FIXTURE, GOBLIN_MONSTER_FIXTURE];
