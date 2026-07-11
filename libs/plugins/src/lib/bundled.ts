import { PluginTypeDefinition } from './define-type';
import { DND_MONSTER_TYPE } from './dnd/monster';

/**
 * Every **bundled plugin** type, compiled in (ADR-0048 — runtime third-party plugins are out of
 * scope; "bundled" means the same compiled-in registration the `CONTENT_EXTENSIONS` and
 * command-palette providers use). The API seeds its `TypeFieldRegistry` from this list and the web
 * layers each one's chrome and View on top, so a new plugin joins both sides by appending here.
 */
export const BUNDLED_PLUGIN_TYPES: readonly PluginTypeDefinition[] = [DND_MONSTER_TYPE];
