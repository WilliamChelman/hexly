import { TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_ASSET_TYPE } from '@hexly/plugin-asset';

/** The Asset View's id — the one mime-dispatching renderer the asset type contributes (ADR-0065). */
export const CORE_VIEW_ASSET: ViewId = 'core.view.asset';

/**
 * The Asset's Type as the web registers it (ADR-0065, ADR-0050): the shared {@link CORE_ASSET_TYPE}
 * declaration — the id and its two Fields (the asset-ref and Content), which the API reads too — plus the
 * chrome only the web has: the icon, the transloco copy, and the graph colour.
 *
 * It places the mime-dispatching Asset View by id (image renderer today, icon card otherwise), which is the
 * whole detail page in one View — rendered bytes, Asset Stats, prose, and usage (ADR-0065). A Board Embed of
 * an Asset transcludes this same View through the Entity View Outlet (ADR-0062).
 */
export const ASSET_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_ASSET_TYPE.id,
    fieldRefs: CORE_ASSET_TYPE.fieldRefs,
    icon: 'asset',
    views: [CORE_VIEW_ASSET],
    graphColorToken: '--color-ink-muted',
    // Carry the shared declaration's System-managed marker across the web seam (ADR-0068): the pickers
    // must not offer the asset type and the Details panel must render it affordance-less.
    systemManaged: CORE_ASSET_TYPE.systemManaged,
    labels: {
      eyebrow: 'asset.eyebrow',
      titleLabel: 'asset.titleLabel',
      rename: 'asset.rename',
      editorLabel: 'asset.editorLabel',
      create: 'asset.create',
      untitled: 'asset.untitled',
    },
  },
];
