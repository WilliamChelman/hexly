/**
 * Tiny committed fixtures (Ajax + one Goblin) that drive the importer's tests offline (ADR-0061). They
 * are trimmed real actor `_source` documents — enough of the shape for the transform to read, keeping the
 * `feature` items (the trait source, #258) and the `ability` items (#259), the latter trimmed to the fields
 * the transform reads (type/category/keywords/distance/target/power/effects). Both keep an `img` so a test
 * can prove the transform never copies art into the Entity Document, and both keep an empty `biography`, so a
 * test can prove an empty biography yields no `core.field.content`. Only a handful are committed; the bulk pack is
 * never vendored.
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
    // The 16 real `ability` items → `abilities[]` (#259): signature/heroic/villain/maliceAncestry categories,
    // multi-tier power rolls composed from `power.effects`, and the flat `effect`/`trigger` text.
    {
      name: 'Blade of the Gol King',
      type: 'ability',
      system: {
        type: 'main',
        category: 'signature',
        keywords: ['charge', 'magic', 'melee', 'strike', 'weapon'],
        distance: {
          type: 'melee',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creatureObject',
          value: 2,
          custom: '',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {
            '7GDdQ4RJaDjxXC83': {
              type: 'damage',
              sort: 0,
              damage: {
                tier1: {
                  value: '16',
                  types: [],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '22',
                  types: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '26',
                  types: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            ByeuzLXX9qKbuqJJ: {
              type: 'other',
              sort: 0,
              other: {
                tier1: {
                  display: '{{potency}} the target loses 1d3 Recoveries',
                  potency: {
                    value: '4',
                    characteristic: 'might',
                  },
                },
                tier2: {
                  display: '{{potency}} the target loses 1d3 Recoveries',
                  potency: {
                    value: '5',
                    characteristic: 'might',
                  },
                },
                tier3: {
                  display: '{{potency}} prone and the target loses 1d3 Recoveries',
                  potency: {
                    value: '6',
                    characteristic: '',
                  },
                },
              },
            },
            xXyzMGoNBbXCedYl: {
              type: 'applied',
              sort: 0,
              applied: {
                tier1: {
                  display: '',
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  display: '',
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  display: '',
                  potency: {
                    value: '@potency.strong',
                    characteristic: 'might',
                  },
                },
              },
            },
          },
        },
        effects: {
          spend00000000000: {
            type: 'spend',
            sort: 100000,
            description: '<p>Ajax can strike one additional target for each Malice spent.</p>',
            resource: {
              value: 1,
              multiple: true,
            },
          },
          after00000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax shifts up to 2 squares between striking each target.</p><p>[[/roll 1d3]]{1d3 recovery loss}</p>',
          },
        },
      },
    },
    {
      name: 'Decree by the Jade Hand',
      type: 'ability',
      system: {
        type: 'main',
        category: '',
        keywords: ['area', 'magic', 'ranged'],
        distance: {
          type: 'cube',
          primary: '3',
          secondary: '10',
          tertiary: '1',
        },
        target: {
          type: 'enemyObject',
          value: null,
          custom: 'Each enemy and object in the area',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {
            '4AWobCfi1Lp5Ao4S': {
              type: 'damage',
              sort: 0,
              damage: {
                tier1: {
                  value: '11',
                  types: ['holy'],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '17',
                  types: ['holy'],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '21',
                  types: ['holy'],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            Wf8gV04xBEWAnZja: {
              type: 'forced',
              sort: 0,
              forced: {
                tier1: {
                  display: '{{forced}}',
                  movement: ['slide'],
                  distance: '2',
                  properties: [],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'might',
                  },
                },
                tier2: {
                  display: '{{forced}}',
                  movement: ['slide'],
                  distance: '5',
                  properties: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: 'might',
                  },
                },
                tier3: {
                  display: '{{forced}}',
                  movement: ['slide'],
                  distance: '8',
                  properties: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: 'might',
                  },
                },
              },
            },
            AtyoWVuj1YtUtktf: {
              type: 'applied',
              sort: 0,
              applied: {
                tier1: {
                  display: '{{potency}} the target is hexed (save ends)',
                  potency: {
                    value: '4',
                    characteristic: 'presence',
                  },
                },
                tier2: {
                  display: '',
                  potency: {
                    value: '5',
                    characteristic: '',
                  },
                },
                tier3: {
                  display: '',
                  potency: {
                    value: '6',
                    characteristic: '',
                  },
                },
              },
            },
          },
        },
        effects: {
          spend00000000000: {
            type: 'spend',
            sort: 100000,
            description:
              '<p>The potency increases by 1. Additionally, the ground beneath the area drops 3 squares and is difficult terrain. Each flying target who has M &lt; 5 is knocked prone.</p>',
            resource: {
              value: 3,
              multiple: false,
            },
          },
          after00000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>A hexed target glows green, and each of their heroic abilities has its cost increased by 2.</p><p>[[/apply prone]]{Malice Prone}</p>',
          },
        },
      },
    },
    {
      name: 'Divine Vine',
      type: 'ability',
      system: {
        type: 'maneuver',
        category: '',
        keywords: ['magic', 'ranged', 'weapon'],
        distance: {
          type: 'ranged',
          primary: '5',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creatureObject',
          value: 1,
          custom: '',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {
            '0CRqXZhWEU1cH72L': {
              type: 'damage',
              sort: 0,
              damage: {
                tier1: {
                  value: '0',
                  types: [],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '0',
                  types: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '11',
                  types: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            sztShTmcjEUyby5y: {
              type: 'applied',
              sort: 0,
              applied: {
                tier1: {
                  display: 'No effect.',
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  display: 'The target is grabbed.',
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  display: 'the target is grabbed',
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
          },
        },
        effects: {
          after00000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>If the target is grabbed, Ajax can choose to keep the vine extended, pull the target adjacent to him, or pull himself adjacent to the target. The vine stays attached to a grabbed target until it takes damage from a strike, the target escapes the grab, or Ajax causes the vine to release the target (no action required).</p><p><strong>Special:</strong> This ability can be replaced with the features of a different treasure Ajax has acquired.</p>',
          },
        },
      },
    },
    {
      name: 'Bead of Hell',
      type: 'ability',
      system: {
        type: 'maneuver',
        category: 'heroic',
        keywords: ['area', 'magic', 'ranged'],
        distance: {
          type: 'cube',
          primary: '5',
          secondary: '20',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: '',
        resource: 2,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax throws a glowing bead to a square within distance, which ignites at the start of Ajax’s next turn and creates an area around it that lasts until the start of Ajax’s following turn. Each enemy in the area when the bead ignites takes 20 fire damage, and if they have [[potency A 5]], they are [[/apply dazed save]]. Any enemy who starts their turn in the area takes [[/damage 10 fire]]{10 fire damage}.</p>',
          },
        },
      },
    },
    {
      name: 'Is This What They Taught You?',
      type: 'ability',
      system: {
        type: 'triggered',
        category: '',
        keywords: ['ranged'],
        distance: {
          type: 'ranged',
          primary: '10',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creature',
          value: null,
          custom: 'The triggering creature',
        },
        trigger: 'A creature within distance marks Ajax.',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>The target is marked while Ajax is marked. While the target is marked this way, Ajax gains an edge on power rolls against them, and whenever the target uses a triggered action involving their mark on Ajax, he can make a free strike against them.</p>',
          },
        },
      },
    },
    {
      name: 'Shieldbreaker Talisman',
      type: 'ability',
      system: {
        type: 'triggered',
        category: '',
        keywords: ['magic', 'melee'],
        distance: {
          type: 'melee',
          primary: '5',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creature',
          value: null,
          custom: 'The triggering creature',
        },
        trigger: 'An enemy within distance uses an ability to reduce damage.',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax makes a free strike against the target, dealing extra damage equal to twice the amount that was reduced. This extra damage can’t be reduced in any way.</p>',
          },
        },
      },
    },
    {
      name: "Who's Hesitating?",
      type: 'ability',
      system: {
        type: 'triggered',
        category: '',
        keywords: [],
        distance: {
          type: 'self',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'self',
          value: null,
          custom: '',
        },
        trigger: 'A creature uses the Hesitation is Weakness ability.',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax shifts up to his speed and can make a free strike. If the target has [[potency R 4]], this free strike also makes them [[/apply weakened turn]]{weakened} until the end of their next turn.</p>',
          },
        },
      },
    },
    {
      name: 'Your Obsession With Me Betrays You',
      type: 'ability',
      system: {
        type: 'triggered',
        category: '',
        keywords: ['magic', 'ranged'],
        distance: {
          type: 'ranged',
          primary: '10',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creature',
          value: null,
          custom: 'The triggering creature',
        },
        trigger: 'Ajax causes a creature within distance to gain ferocity or wrath.',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              "<p>If the target has[[potency I 4]], they use a signature ability against a target of Ajax's choice.</p>",
          },
        },
      },
    },
    {
      name: 'You Would Flounder Your Assault?',
      type: 'ability',
      system: {
        type: 'triggered',
        category: 'heroic',
        keywords: ['magic'],
        distance: {
          type: 'self',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'self',
          value: null,
          custom: '',
        },
        trigger: 'A creature within 10 squares regains Stamina.',
        resource: 2,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description: '<p>Ajax regains the same amount of Stamina.</p>',
          },
        },
      },
    },
    {
      name: 'Phoenix Wing King',
      type: 'ability',
      system: {
        type: 'villain',
        category: 'villain',
        keywords: ['area', 'magic', 'weapon'],
        distance: {
          type: 'burst',
          primary: '5',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'enemy',
          value: null,
          custom: 'Each enemy in the area',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {
            '11qGfRWAnifB8MyB': {
              type: 'damage',
              sort: 0,
              damage: {
                tier1: {
                  value: '11',
                  types: ['fire'],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '17',
                  types: ['fire'],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '21',
                  types: ['fire'],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            HYVER5yL3I1gwgjB: {
              type: 'applied',
              sort: 0,
              applied: {
                tier1: {
                  display: '{{potency}} weakened (save ends)',
                  potency: {
                    value: '4',
                    characteristic: 'agility',
                  },
                },
                tier2: {
                  display: '',
                  potency: {
                    value: '5',
                    characteristic: 'agility',
                  },
                },
                tier3: {
                  display: '',
                  potency: {
                    value: '6',
                    characteristic: 'agility',
                  },
                },
              },
            },
          },
        },
        effects: {
          after00000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax flies at high speed to cut through each target, then appears in an unoccupied space within distance.</p>',
          },
        },
      },
    },
    {
      name: "I've Learned Their Tricks",
      type: 'ability',
      system: {
        type: 'villain',
        category: 'villain',
        keywords: ['area'],
        distance: {
          type: 'burst',
          primary: '3',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'enemy',
          value: null,
          custom: 'Each enemy in the area',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax uses the shadow elf eclipse’s technique to reduce each target’s surges to 0. Additionally, until the end of the round, Ajax ignores edges and double edges on any target’s abilities, and ignores any nondamaging effects of any target’s damage-dealing abilities.</p><p><strong>Special:</strong> This villain action can be replaced with a villain action from a creature any target has previously encountered.</p>',
          },
        },
      },
    },
    {
      name: 'Awe of the Iron Crown',
      type: 'ability',
      system: {
        type: 'villain',
        category: 'villain',
        keywords: ['area', 'magic'],
        distance: {
          type: 'burst',
          primary: '7',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'enemy',
          value: null,
          custom: 'Each enemy in the area',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Each target who has [[potency I 5]] is knocked [[/apply prone]] and [[/apply 8PBTSqtB8xUXvdtu]] until Ajax deals damage to them. For each target not knocked prone, Ajax can move up to his speed toward that target and use Blade of the Gol King against them.</p>',
          },
        },
      },
    },
    {
      name: 'Reason',
      type: 'ability',
      system: {
        type: 'none',
        category: 'maliceAncestry',
        keywords: [],
        distance: {
          type: 'special',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: 'A ajax’s starts its turn.',
        resource: 2,
        power: {
          roll: {
            characteristics: [],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax attempts to instill doubt into a creature within line of effect through logic and reason. The creature and Ajax make an opposed <span style="text-decoration:underline"><strong>Reason test</strong></span>. If Ajax wins, he chooses to either deal [[/damage 11 extra]] damage action during the current round. Ajax can’t use this feature against the same creature during the same encounter.</p>',
          },
        },
      },
    },
    {
      name: 'Nexus Jewel',
      type: 'ability',
      system: {
        type: 'none',
        category: 'maliceAncestry',
        keywords: [],
        distance: {
          type: 'special',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: 'A ajax’s starts its turn.',
        resource: 5,
        power: {
          roll: {
            characteristics: [],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Until the end of the round, Ajax chooses one of the following environments on top of the encounter map, temporarily merging multiple realities.</p><p><span style="text-decoration:underline"><strong><span style="text-decoration:underline">Incredibly High Above the Ground:</span></strong></span> The winds whip and bluster. Any creature who can’t fly takes a −3 penalty to stability, and forced movement effects gain a +3 bonus to their distance against such creatures. [[/apply GuQPGtkIXZ53LJsT]]</p><p><span style="text-decoration:underline"><strong><span style="text-decoration:underline">Swamp</span></strong></span>: The ground is difficult terrain for enemies. Any creature who starts and ends their turn in the same space is [[/apply restrained save]]</p><p><span style="text-decoration:underline"><strong><span style="text-decoration:underline">Volcanic Canyon:</span></strong></span> The air is stiflingly hot. Each enemy takes [[/damage 5 fire]]{5 fire damage} for each square they enter.</p>',
          },
        },
      },
    },
    {
      name: 'Solo Action',
      type: 'ability',
      system: {
        type: 'none',
        category: 'maliceAncestry',
        keywords: [],
        distance: {
          type: 'special',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: 'A ajax’s starts its turn.',
        resource: 5,
        power: {
          roll: {
            characteristics: [],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax takes an additional main action on his turn. He can use this feature even if he is dazed.</p>',
          },
        },
      },
    },
    {
      name: 'Draw Steel',
      type: 'ability',
      system: {
        type: 'main',
        category: 'maliceAncestry',
        keywords: ['area', 'magic', 'ranged', 'weapon'],
        distance: {
          type: 'cube',
          primary: '3',
          secondary: '10',
          tertiary: '1',
        },
        target: {
          type: 'enemyObject',
          value: null,
          custom: 'Each enemy and object in the area',
        },
        trigger: 'A ajax’s starts its turn.',
        resource: 10,
        power: {
          roll: {
            characteristics: ['might', 'agility', 'reason', 'intuition', 'presence'],
            reactive: true,
          },
          effects: {
            bhl2jxko2ROn5cTB: {
              type: 'damage',
              sort: 100000,
              damage: {
                tier1: {
                  value: '26',
                  types: [],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '22',
                  types: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '16',
                  types: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            tKr4w034TXF3m59T: {
              type: 'applied',
              sort: 200000,
              applied: {
                tier1: {
                  display: 'bleeding and slowed (save ends)',
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  display: 'bleeding (save ends)',
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  display: '',
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
          },
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p><strong>NOTE:</strong> area is Four 3 cubes within 10</p><p>Each target makes a test using their highest characteristic.</p>',
          },
          after00000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>Ajax then raises his Blade of the Gol King above his head as four giant blades emerge from the ground to fill the area. Each target is pushed into an unoccupied space adjacent to the area after the power roll is resolved. Each blade blocks line of effect and can be dismissed by Ajax at will (no action required).</p>',
          },
        },
      },
    },
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
    // Empty in the real actor — so this fixture proves an empty biography yields no `core.field.content` (#258).
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
    // The 5 real `ability` items → `abilities[]` (#259): a signature strike, a strike whose applied bleeding tier
    // carries a potency, and three malice actions — one (Swamp Stink) with reactive applied-condition tiers.
    {
      name: 'Spear Charge',
      type: 'ability',
      system: {
        type: 'main',
        category: 'signature',
        keywords: ['charge', 'melee', 'strike', 'weapon'],
        distance: {
          type: 'melee',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creatureObject',
          value: 1,
          custom: '',
        },
        trigger: '',
        resource: null,
        power: {
          roll: {
            characteristics: ['agility'],
            reactive: false,
          },
          effects: {
            Y0x6xGOw9jHthmy2: {
              type: 'damage',
              sort: 0,
              damage: {
                tier1: {
                  value: '3',
                  types: [],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '4',
                  types: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '5',
                  types: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
          },
        },
        effects: {},
      },
    },
    {
      name: 'Bury The Point',
      type: 'ability',
      system: {
        type: 'main',
        category: '',
        keywords: ['melee', 'strike', 'weapon'],
        distance: {
          type: 'melee',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'creature',
          value: 1,
          custom: '',
        },
        trigger: '',
        resource: 2,
        power: {
          roll: {
            characteristics: ['agility'],
            reactive: false,
          },
          effects: {
            '01HwzAUekvCFF0rj': {
              type: 'damage',
              sort: 0,
              damage: {
                tier1: {
                  value: '5',
                  types: [],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '6',
                  types: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '7',
                  types: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            '0tycnfBe8bYXrZYF': {
              type: 'applied',
              sort: 0,
              applied: {
                tier1: {
                  display: '{{potency}} bleeding (save ends)',
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'might',
                  },
                },
                tier2: {
                  display: '',
                  potency: {
                    value: '@potency.average',
                    characteristic: 'might',
                  },
                },
                tier3: {
                  display: '',
                  potency: {
                    value: '@potency.strong',
                    characteristic: 'might',
                  },
                },
              },
            },
          },
        },
        effects: {},
      },
    },
    {
      name: 'Goblin Mode',
      type: 'ability',
      system: {
        type: 'none',
        category: 'maliceAncestry',
        keywords: [],
        distance: {
          type: 'special',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: 'A goblin starts its turn.',
        resource: 3,
        power: {
          roll: {
            characteristics: [],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description: '<p>Each goblin in the encounter gains a +2 bonus to speed until the end of the round.</p>',
          },
        },
      },
    },
    {
      name: 'Tiny Stabs',
      type: 'ability',
      system: {
        type: 'none',
        category: 'maliceAncestry',
        keywords: [],
        distance: {
          type: 'special',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: 'A goblin starts its turn.',
        resource: 5,
        power: {
          roll: {
            characteristics: [],
            reactive: false,
          },
          effects: {},
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description: '<p>Each enemy in the encounter takes 1 damage for each goblin adjacent to them.</p>',
          },
        },
      },
    },
    {
      name: 'Swamp Stink',
      type: 'ability',
      system: {
        type: 'none',
        category: 'maliceAncestry',
        keywords: [],
        distance: {
          type: 'special',
          primary: '1',
          secondary: '1',
          tertiary: '1',
        },
        target: {
          type: 'special',
          value: null,
          custom: '',
        },
        trigger: 'A goblin starts its turn.',
        resource: 7,
        power: {
          roll: {
            characteristics: ['might'],
            reactive: true,
          },
          effects: {
            EWNCOLfzWPAraIBv: {
              type: 'damage',
              sort: 100000,
              damage: {
                tier1: {
                  value: '5',
                  types: ['poison'],
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  value: '',
                  types: [],
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  value: '',
                  types: [],
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
            VdDO5uml16reG0t7: {
              type: 'applied',
              sort: 200000,
              applied: {
                tier1: {
                  display: 'the creature is weakened until the mist disappears.',
                  potency: {
                    value: '@potency.weak',
                    characteristic: 'none',
                  },
                },
                tier2: {
                  display: 'The creature is weakened until the mist disappears.',
                  potency: {
                    value: '@potency.average',
                    characteristic: '',
                  },
                },
                tier3: {
                  display: 'No effect.',
                  potency: {
                    value: '@potency.strong',
                    characteristic: '',
                  },
                },
              },
            },
          },
        },
        effects: {
          before0000000000: {
            type: 'base',
            sort: 0,
            description:
              '<p>The encounter map is covered in a green mist that lasts until the end of the round, and which can’t be dispersed by wind. All areas of the map are difficult terrain for non-goblins, and each non-goblin on the map makes a <strong>Might test.</strong></p>',
          },
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
