import { FeatureId, terrainSet, TerrainId } from '@hexly/plugin-hexmap';
import { DesignToken } from '@hexly/web-styles';

/**
 * i18n keys for the built-in catalog labels, keyed by their stable `id`
 * (`map.terrain.<id>` / `map.feature.<id>`, ADR-0014). The id is
 * schema-constrained to the built-in set/library
 * (`terrainIdSchema`/`featureIdSchema`), so every stored id resolves to a real
 * key and no fallback guard is needed.
 */
export const terrainKey = (id: TerrainId): string => `map.terrain.${id}`;

export const featureKey = (id: FeatureId): string => `map.feature.${id}`;

/**
 * The terrain set's fills, keyed for lookup. `Terrain.fill` is `DesignToken` at its own declaration
 * (ADR-0075, #364), so nothing is recovered here — the annotation only restores the key totality
 * `Object.fromEntries` widens away.
 */
const TERRAIN_FILL = Object.fromEntries(terrainSet.map((t) => [t.id, t.fill])) as Readonly<
  Record<TerrainId, DesignToken>
>;

/** A terrain's fill token — asked for rather than spliced into `--color-terrain-<id>`, which nothing checks. */
export const terrainFill = (id: TerrainId): DesignToken => TERRAIN_FILL[id];
