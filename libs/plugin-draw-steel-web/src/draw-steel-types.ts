import { TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT } from '@hexly/plugin-content/web';
import { DS_MONSTER_TYPE, DS_STAT_BLOCK_KEY } from '@hexly/plugin-draw-steel';

/**
 * The stat-block View. View ids live in the plugin's own `draw-steel.view.*` sub-namespace, a keyspace
 * away from the type id (`draw-steel.type.monster`), the Field data-type id (`draw-steel.datatype.stat-block`), and the
 * Field id (`draw-steel.field.stat-block`) (ADR-0050).
 */
export const DS_VIEW_STAT_BLOCK: ViewId = 'draw-steel.view.stat-block';

/**
 * The Draw Steel plugin's types as the web registers them: the shared {@link DS_MONSTER_TYPE}
 * declaration plus the chrome only the web has — icon, transloco copy, and the Views it contributes. The
 * first View listed is the type's default.
 *
 * Must stay component-import-free, so {@link providePluginDrawSteel} can seed the root registry at
 * startup; the stat-block component itself hangs off that provider's `loadComponent`.
 */
export const DS_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: DS_MONSTER_TYPE.id,
    // References the prose and stat-block Fields by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: DS_MONSTER_TYPE.fieldRefs,
    // The crossed-swords glyph, so a Draw Steel monster reads apart from a `dnd.type.monster`'s skull (#242).
    icon: 'swords',
    // The stat block placed by its `{ field }` — the `draw-steel.datatype.stat-block` data-type's View, labelled by
    // the Field (ADR-0055) — then the content View by id, so a monster opens on its stats with a Note toggle.
    views: [{ field: DS_STAT_BLOCK_KEY }, CORE_VIEW_RICH_CONTENT],
    // Pinned off its derived tone-1, which `core.type.board` holds (ADR-0075). Neither teal is free, so
    // tone-4 is the nearest cool tone left to the water this type shipped as; `type-tones.spec` holds
    // the set distinct. No `graphColorToken`: the node takes this same tone.
    tone: 'tone-4',
    // A plugin ships translated copy, so its chrome is transloco keys — unlike a user-defined type,
    // whose every label is its one authored name (#191).
    // Chrome copy under the `drawSteel` scope (see `draw-steel-translations.ts` for the camel-cased name).
    labels: {
      name: 'drawSteel.monster.name',
      eyebrow: 'drawSteel.monster.eyebrow',
      titleLabel: 'drawSteel.monster.titleLabel',
      rename: 'drawSteel.monster.rename',
      editorLabel: 'drawSteel.monster.editorLabel',
      create: 'drawSteel.monster.create',
      untitled: 'drawSteel.monster.untitled',
    },
  },
];
