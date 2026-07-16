import { TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_VIEW_CONTENT } from '@hexly/plugin-content/web';
import { DND_MONSTER_TYPE } from '../lib/monster';

/**
 * The `dnd.monster` bespoke View. View ids live in the plugin's own `dnd.view.*` sub-namespace, a
 * keyspace away from the type id (`dnd.monster`) and from the Field data-type ids (ADR-0050).
 */
export const DND_VIEW_STAT_BLOCK: ViewId = 'dnd.view.stat-block';

/**
 * The D&D plugin's types as the web registers them: the shared {@link DND_MONSTER_TYPE} declaration
 * plus the chrome only the web has — icon, transloco copy, and the Views it contributes. The first
 * View listed is the type's default.
 *
 * Must stay component-import-free, so {@link providePluginDnd} can seed the root registry at startup;
 * the stat-block component itself hangs off that provider's `loadComponent`.
 */
export const DND_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: DND_MONSTER_TYPE.id,
    fields: DND_MONSTER_TYPE.fields,
    // References the prose and stat-block Fields by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: DND_MONSTER_TYPE.fieldRefs,
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
