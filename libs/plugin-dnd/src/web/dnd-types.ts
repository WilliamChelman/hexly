import { CORE_VIEW_CONTENT, TypeDefinition, ViewId } from '@hexly/web-entity';
import { DND_MONSTER_TYPE } from '../lib/monster';

/**
 * The `dnd.monster` bespoke View (#192). It lives in the plugin's own `dnd.view.*` sub-namespace, a
 * keyspace away from the type id (`dnd.monster`) and from the Field data-type ids (ADR-0050).
 */
export const DND_VIEW_STAT_BLOCK: ViewId = 'dnd.view.stat-block';

/**
 * The D&D plugin's types as the web registers them: the shared {@link DND_MONSTER_TYPE} declaration
 * (the id and Field schema the API reads too) plus the chrome only the web has — icon, transloco
 * copy, and the Views it contributes. The app feeds these to the same `TypeRegistry.register()` the
 * core types use.
 *
 * A monster contributes the stat block, then the Content view carrying its lore, so the header offers
 * both and defaults to the stat block (the primary type's first View). It contributes no generic
 * Field View — that is what shipping a bespoke one replaces. Add `core.hexmap` and the Entity affords
 * all three, by the ordinary view-per-surface union.
 *
 * Component-import-free, so {@link providePluginDnd} can seed the root registry at startup; the
 * stat-block component itself hangs off that provider's `loadComponent`.
 */
export const DND_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: DND_MONSTER_TYPE.id,
    fields: DND_MONSTER_TYPE.fields,
    icon: 'skull',
    views: [DND_VIEW_STAT_BLOCK, CORE_VIEW_CONTENT],
    // The tertiary role from the palette (docs/design/identity.md). Not `--color-ember`, which is
    // Danger.
    graphColorToken: '--color-astra',
    // A plugin ships translated copy, so its chrome is transloco keys — unlike a user-defined type,
    // whose every label is its one authored name (#191).
    labels: {
      eyebrow: 'dnd.monster.eyebrow',
      titleLabel: 'dnd.monster.titleLabel',
      rename: 'dnd.monster.rename',
      editorLabel: 'dnd.monster.editorLabel',
      create: 'dnd.monster.create',
      untitled: 'dnd.monster.untitled',
    },
  },
];
