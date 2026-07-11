import { DND_MONSTER, DND_MONSTER_TYPE } from '@hexly/plugins';
import { TypeDefinition } from '../../entity-types/type-definition';
import { CORE_VIEW_CONTENT } from '../../entity-types/view-definition';

/**
 * The `dnd.monster` **bespoke View** (#192) — the stat block a player expects, rather than raw prose
 * or a generic Field list. It lives in the plugin's own `dnd.view.*` sub-namespace, a keyspace away
 * from the type id (`dnd.monster`) and the closed Payload Kind names (ADR-0048).
 */
export const DND_VIEW_STAT_BLOCK = 'dnd.view.stat-block';

/**
 * The **web half** of the D&D plugin (#192): the shared {@link DND_MONSTER_TYPE} declaration — the
 * id, and the Field schema the API reads too — dressed in the chrome only the web has (icon,
 * transloco copy, Views), and registered with the {@link TypeRegistry} through the *same* `register()`
 * the core types use. Nothing here is a parallel mechanism: swap `core-types.ts` for this file and
 * the registry cannot tell the difference.
 *
 * A monster contributes two Views — its stat block, then the Content view carrying its lore — so the
 * header offers stat-block + Note and defaults to the stat block (the primary type's first View). It
 * pointedly does *not* contribute the generic Field View: a bespoke view is exactly what a plugin
 * buys with code. Compose `dnd.monster` with `core.hexmap` and the Entity affords all three (Note,
 * Map, and the stat block) — the view-per-surface union falling out of the registry, not a special
 * case.
 *
 * Component-import-free, like `core-types.ts`: the stat-block component registers itself from the
 * lazy entity chunk (`dnd-views.ts`), so it never reaches the initial bundle.
 */
export const DND_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: DND_MONSTER,
    icon: 'skull',
    views: [DND_VIEW_STAT_BLOCK, CORE_VIEW_CONTENT],
    fields: DND_MONSTER_TYPE.fields,
    // The tertiary accent — a plugin picks a *role* from the palette (identity.md), never a colour,
    // and a monster is not an error state, so `--color-ember` (Danger) is not its to take.
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
