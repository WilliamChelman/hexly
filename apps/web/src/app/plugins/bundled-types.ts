import { TypeDefinition } from '../entity-types/type-definition';
import { DND_TYPE_DEFINITIONS } from './dnd/dnd-types';

/**
 * The **web half** of every bundled plugin's type registration (ADR-0048, #192) — the twin of
 * `@hexly/plugins`' `BUNDLED_PLUGIN_TYPES`, which is the half the API reads. A plugin joins Hexly by
 * appending to those two lists: its shared declaration (id, label, Fields) there, its chrome and
 * Views here.
 *
 * The root `TypeRegistry` seeds itself from this list, so a second plugin (`pathfinder.monster`)
 * touches this file and its own folder — never the registry. Component-import-free, like the core's
 * `core-types.ts`: the view components register separately (see `bundled-views.ts`), so they stay off
 * the initial bundle.
 */
export const PLUGIN_TYPE_DEFINITIONS: readonly TypeDefinition[] = [...DND_TYPE_DEFINITIONS];
