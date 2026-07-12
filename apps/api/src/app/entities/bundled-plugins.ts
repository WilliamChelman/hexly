import { PluginTypeDefinition } from '@hexly/domain';
import { DND_MONSTER_TYPE } from '@hexly/plugin-dnd';

/**
 * Which plugins this build bundles, API side (ADR-0048, #192) — the composition root's list, and the
 * twin of the web's. "Bundled" means compiled-in (the ADR rules out runtime third-party plugins), so
 * a plugin joins Hexly by shipping a lib and being named in these two lists.
 *
 * Only the *framework-free* half of a plugin is imported here — its id, label, and Field schema. The
 * API validates and facets a monster without ever learning that a stat-block view exists.
 */
export const BUNDLED_PLUGIN_TYPES: readonly PluginTypeDefinition[] = [DND_MONSTER_TYPE];
