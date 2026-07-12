import { DND_TYPE_DEFINITIONS } from '@hexly/plugin-dnd/web';
import { TypeDefinition } from '@hexly/web-entity';

/**
 * Which plugins this build bundles, web side (ADR-0048, #192) — the composition root's list, and the
 * twin of the API's own. "Bundled" means compiled-in (the ADR rules out runtime third-party plugins),
 * so a plugin joins Hexly by shipping a lib and being named in these two lists — nothing in the
 * registries or the page ever learns a plugin's name.
 *
 * Component-import-free, so the root `TypeRegistry` can seed itself from it at startup; a plugin's
 * Views register separately, from the lazy entity chunk (`bundled-views.ts`).
 */
export const PLUGIN_TYPE_DEFINITIONS: readonly TypeDefinition[] = [...DND_TYPE_DEFINITIONS];
