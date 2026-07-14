/**
 * The server counterpart to the web's `providePlugin` (ADR-0053, the API-side mirror of ADR-0048): a
 * bundled plugin's single framework-free entry point into the API. A plugin exports one
 * `serverPluginX()` built from this, and the composition root (`bundled-plugins.ts`) folds the list —
 * so a plugin's server contribution is stated once, in the plugin, instead of scattered across the
 * composition root's imports.
 *
 * Only a plugin's framework-free half is ever named here: its Type declarations, the **Structured
 * Field** data-types those types resolve against (the vault-enabled variant, since the API runs vault
 * I/O — ADR-0051), and, for the one plugin that owns it, the default Entity Type.
 */

import { EntityType } from './entity';
import { PluginTypeDefinition } from './plugin-type';
import { StructuredDataType } from './structured-data-type';

/** What a bundled plugin contributes to the API (ADR-0053). The web twin is `WebPlugin`. */
export interface ServerPlugin {
  /** The code-registered Entity Types this plugin declares (ADR-0048). */
  readonly types?: readonly PluginTypeDefinition[];
  /**
   * The **Structured Field** data-types this plugin's types name by `kind` (ADR-0050). The API bundles
   * the vault-enabled variant, since it resolves both the derive pass and the vault projection off this
   * set (ADR-0051).
   */
  readonly dataTypes?: readonly StructuredDataType[];
  /**
   * The Entity Type a vault import assigns a Markdown file with no `hexly.type` stamp — the "bare Note"
   * default (ADR-0051). Set by exactly one plugin (content); the composition root reads it from there
   * so the vault services need not import the content plugin to learn the default.
   */
  readonly defaultType?: EntityType;
}

/**
 * A bundled plugin's single entry point into the API (ADR-0053): a plugin exports one `serverPluginX()`
 * built from this, and `bundled-plugins.ts` names it. "Bundled" means compiled-in — there are no
 * runtime third-party plugins — so a plugin joins by shipping a lib and being named there.
 */
export function serverPlugin(plugin: ServerPlugin): ServerPlugin {
  return Object.freeze({
    types: plugin.types ?? [],
    dataTypes: plugin.dataTypes ?? [],
    defaultType: plugin.defaultType,
  });
}
