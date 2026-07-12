import { CORE_VIEW_CONTENT, TypeDefinition, ViewId } from '@hexly/web-entity';
import { DND_MONSTER_TYPE } from '../lib/monster';

/**
 * The `dnd.monster` **bespoke View** (#192) — the stat block a player expects, rather than raw prose
 * or a generic Field list. It lives in the plugin's own `dnd.view.*` sub-namespace, a keyspace away
 * from the type id (`dnd.monster`) and the closed Payload Kind names (ADR-0048).
 */
export const DND_VIEW_STAT_BLOCK: ViewId = 'dnd.view.stat-block';

/**
 * The D&D plugin's types as the **web** registers them: the shared {@link DND_MONSTER_TYPE}
 * declaration — the id and Field schema the API reads too — wearing the chrome only the web has (an
 * icon, transloco copy, the Views it contributes). The app registers these through the very same
 * `TypeRegistry.register()` the core types use; the registry cannot tell the two apart, which is the
 * point.
 *
 * A monster contributes two Views — its stat block, then the Content view carrying its lore — so the
 * header offers stat-block + Note and defaults to the stat block (the primary type's first View). It
 * pointedly does *not* contribute the generic Field View: a bespoke view is exactly what a plugin
 * buys with code. Compose `dnd.monster` with `core.hexmap` and the Entity affords all three (Note,
 * Map, and the stat block) — the view-per-surface union falling out of the registry, not a special
 * case.
 *
 * Component-import-free, so it can seed the root registry at startup: the stat-block component
 * registers separately, from the lazy entity chunk (`dnd-views.ts`).
 */
export const DND_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: DND_MONSTER_TYPE.id,
    fields: DND_MONSTER_TYPE.fields,
    icon: 'skull',
    views: [DND_VIEW_STAT_BLOCK, CORE_VIEW_CONTENT],
    // The tertiary accent — a type picks a *role* from the palette (docs/design/identity.md), never a
    // colour, and a monster is not an error state, so `--color-ember` (Danger) is not its to take.
    graphColorToken: '--color-astra',
    // A plugin ships translated copy, so its chrome is transloco keys — unlike a user-defined type,
    // whose every label is its one authored name (#191).
    labels: {
      eyebrow: 'plugins.dnd.monster.eyebrow',
      titleLabel: 'plugins.dnd.monster.titleLabel',
      rename: 'plugins.dnd.monster.rename',
      editorLabel: 'plugins.dnd.monster.editorLabel',
      create: 'plugins.dnd.monster.create',
      untitled: 'plugins.dnd.monster.untitled',
    },
  },
];
