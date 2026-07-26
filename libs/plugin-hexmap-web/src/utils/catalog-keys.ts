import { FeatureId, terrainPalette, TerrainId } from '@hexly/plugin-hexmap';
import { DesignToken } from '@hexly/web-styles';

/**
 * i18n keys for the built-in catalog labels, keyed by their stable `id`
 * (`map.terrain.<id>` / `map.feature.<id>`, ADR-0014). The id is
 * schema-constrained to the built-in palette/library
 * (`terrainIdSchema`/`featureIdSchema`), so every stored id resolves to a real
 * key and no fallback guard is needed.
 */
export const terrainKey = (id: TerrainId): string => `map.terrain.${id}`;

export const featureKey = (id: FeatureId): string => `map.feature.${id}`;

/**
 * The palette's fills at the token type. The callback's return annotation is what holds each `fill` to
 * the manifest (ADR-0075); it lives here rather than on `Terrain.fill` because the API's graph reaches
 * the kernel that declares the palette (ADR-0058). The cast only restores the key totality
 * `Object.fromEntries` widens away — `TerrainId` is the palette's own ids.
 */
const TERRAIN_FILL = Object.fromEntries(
  terrainPalette.map((t): [TerrainId, DesignToken] => [t.id, t.fill]),
) as Readonly<Record<TerrainId, DesignToken>>;

/** A terrain's fill token — asked for rather than spliced into `--color-terrain-<id>`, which nothing checks. */
export const terrainFill = (id: TerrainId): DesignToken => TERRAIN_FILL[id];
