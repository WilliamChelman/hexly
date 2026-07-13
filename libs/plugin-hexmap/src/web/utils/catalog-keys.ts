import { FeatureId, TerrainId } from '../../lib';

/**
 * i18n keys for the built-in catalog labels, keyed by their stable `id`
 * (`map.terrain.<id>` / `map.feature.<id>`, ADR-0014). The id is
 * schema-constrained to the built-in palette/library
 * (`terrainIdSchema`/`featureIdSchema`), so every stored id resolves to a real
 * key and no fallback guard is needed.
 */
export const terrainKey = (id: TerrainId): string => `map.terrain.${id}`;

export const featureKey = (id: FeatureId): string => `map.feature.${id}`;
