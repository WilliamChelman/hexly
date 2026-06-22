import { FeatureId, TerrainId } from '@hexly/domain';

/**
 * The i18n keys for the built-in catalog labels, keyed by their stable `id`
 * (`domain.terrain.<id>` / `domain.feature.<id>`, ADR-0014). The label is
 * localized at this UI layer, not in the framework-agnostic domain lib.
 *
 * The id is schema-constrained to the built-in palette/library
 * (`terrainIdSchema`/`featureIdSchema`), so every stored id resolves to a real
 * key — no fallback guard is needed. These centralize the key construction the
 * inspector, map-canvas readout, and tool palette all share.
 */
export const terrainKey = (id: TerrainId): string => `domain.terrain.${id}`;

export const featureKey = (id: FeatureId): string => `domain.feature.${id}`;
