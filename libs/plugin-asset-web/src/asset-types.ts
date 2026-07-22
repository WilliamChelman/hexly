import { CORE_VIEW_FIELDS, TypeDefinition } from '@hexly/web-entity';
import { CORE_ASSET_TYPE } from '@hexly/plugin-asset';

/**
 * The Asset's Type as the web registers it (ADR-0065, ADR-0050): the shared {@link CORE_ASSET_TYPE}
 * declaration — the id and its two Fields (the asset-ref and Content), which the API reads too — plus the
 * chrome only the web has: the icon, the transloco copy, and the graph colour.
 *
 * Views are the generic Field view for now: the mime-dispatching Asset renderer (image today; PDF/audio
 * later) is its own ticket (ADR-0065). Until then an Asset opens on the generic view — its ref and prose
 * among the values it shows — the ordinary skeleton state.
 */
export const ASSET_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_ASSET_TYPE.id,
    fieldRefs: CORE_ASSET_TYPE.fieldRefs,
    icon: 'asset',
    views: [CORE_VIEW_FIELDS],
    graphColorToken: '--color-ink-muted',
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
