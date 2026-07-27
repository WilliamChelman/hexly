import { TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT } from '@hexly/plugin-content/web';
import { DND_MONSTER_TYPE, DND_STAT_BLOCK_KEY } from '@hexly/plugin-dnd';

/**
 * The stat-block View. View ids live in the plugin's own `dnd.view.*` sub-namespace, a keyspace away
 * from the type id (`dnd.type.monster`), the Field data-type id (`dnd.datatype.stat-block`), and the Field id
 * (`dnd.field.stat-block`) (ADR-0050).
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
    // References the prose and stat-block Fields by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: DND_MONSTER_TYPE.fieldRefs,
    icon: 'skull',
    // The stat block placed by its `{ field }` — the `dnd.datatype.stat-block` data-type's View, labelled by the
    // Field (ADR-0055) — then the content View by id, so a monster opens on its stats with a Note toggle.
    views: [{ field: DND_STAT_BLOCK_KEY }, CORE_VIEW_RICH_CONTENT],
    // No `tone` and no `graphColorToken`: this type is categorical, so it takes its derived tone on
    // both surfaces (ADR-0075). Declaring either would be pinning a colour nothing asked to pin.
    // A plugin ships translated copy, so its chrome is transloco keys — unlike a user-defined type,
    // whose every label is its one authored name (#191).
    labels: {
      name: 'dnd.monster.name',
      eyebrow: 'dnd.monster.eyebrow',
      titleLabel: 'dnd.monster.titleLabel',
      rename: 'dnd.monster.rename',
      editorLabel: 'dnd.monster.editorLabel',
      create: 'dnd.monster.create',
      untitled: 'dnd.monster.untitled',
    },
  },
];
