/**
 * The Hex Map document: the sparse, infinite plane a user paints (CONTEXT.md,
 * ADR-0003). A Hex exists *only* where painted, so the document stores hexes in
 * a Record keyed by coordinate — an absent key is Void, costing no storage. The
 * Zod schema here is the single source of truth (ADR-0005): the document types
 * are inferred from it, and it validates on the way in and out.
 */

import { z } from 'zod';
import { Axial } from './coordinates';

/** The document key for a coordinate: `"q,r"`, so the hex Record is plain JSON. */
export function coordKey({ q, r }: Axial): string {
  return `${q},${r}`;
}

/** Recover the axial coordinate a {@link coordKey} encodes. */
export function parseCoordKey(key: string): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/** A built-in terrain: a stable `id`, a `label` to display, and its fill token. */
export interface Terrain {
  /** Stable identifier referenced by every Hex; never shown to the user. */
  readonly id: string;
  /** Human-facing name for the palette (CONTEXT.md vocabulary). */
  readonly label: string;
  /** The CSS custom property the renderer fills painted hexes with (ADR-0006). */
  readonly fill: string;
}

/**
 * The built-in terrain palette: the fixed set a user can paint with for now.
 * Ids are stable (stored in documents); labels and fills are presentation.
 * `as const satisfies` keeps the ids as literals — so {@link TerrainId} is a
 * real union, not `string` — while still checking each entry against
 * {@link Terrain}.
 */
export const terrainPalette = [
  { id: 'grass', label: 'Grassland', fill: '--color-terrain-grass' },
  { id: 'forest', label: 'Forest', fill: '--color-terrain-forest' },
  { id: 'ocean', label: 'Ocean', fill: '--color-terrain-ocean' },
  { id: 'mountain', label: 'Mountains', fill: '--color-terrain-mountain' },
  { id: 'desert', label: 'Desert', fill: '--color-terrain-desert' },
  { id: 'sky', label: 'Sky', fill: '--color-terrain-sky' },
] as const satisfies readonly Terrain[];

/**
 * Build a Zod enum from a palette's ids, isolating the non-empty-tuple cast Zod
 * requires while preserving the inferred literal types.
 */
function idEnum<Id extends string>(ids: readonly Id[]) {
  return z.enum(ids as [Id, ...Id[]]);
}

/** A terrain id constrained to the built-in palette — the source of truth. */
export const terrainIdSchema = idEnum(terrainPalette.map((t) => t.id));

/** A built-in Feature icon: a stable `id`, a `label`, and its marker artwork. */
export interface Feature {
  /** Stable identifier a Hex references; stored in documents, never shown. */
  readonly id: string;
  /** Human-facing name for the palette (CONTEXT.md → Feature). */
  readonly label: string;
  /**
   * The SVG path (`d`) of the marker, drawn in a 24×24 box. The single source
   * of truth for both the canvas Path2D and the palette/icon component — the
   * Feature analogue of a Terrain's `fill` token (ADR-0006/0007).
   */
  readonly path: string;
}

/**
 * The built-in Feature library: the fixed icon set a user can place for now
 * (no uploads — issue #7). Ids are stable (stored in documents); labels and
 * paths are presentation. `as const satisfies` keeps the ids as literals so
 * {@link FeatureId} is a real union, not `string`.
 */
export const featureLibrary = [
  { id: 'settlement', label: 'Settlement', path: 'M5 19v-7l7-5 7 5v7z M10 19v-4h4v4' },
  { id: 'ruin', label: 'Ruin', path: 'M5 20V9l3 2V7l3 2V6l3 3 3-3v14z' },
] as const satisfies readonly Feature[];

/** A feature id constrained to the built-in library — the source of truth. */
export const featureIdSchema = idEnum(featureLibrary.map((f) => f.id));

/** A feature placed on a Hex: a reference to a built-in library id (issue #7). */
export const featureRefSchema = z.object({ ref: featureIdSchema });

/**
 * A painted Hex. Carries exactly one Terrain, plus at most one Feature and an
 * optional name (CONTEXT.md → Hex; ADR-0016). `feature` and `name` are optional
 * and absent unless set, so a document saved before either existed parses
 * unchanged. The name is structured metadata bound to the coordinate — it
 * travels with the Hex on move/swap — distinct from a free-positioned Label.
 */
export const hexSchema = z.object({
  terrain: terrainIdSchema,
  feature: featureRefSchema.optional(),
  name: z.string().optional(),
});

/** A six-digit `#rrggbb` colour, the form a Region's user-chosen border colour is stored in. */
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * A Region: a named, colored grouping of hex coordinates (CONTEXT.md → Region,
 * issue #8). Membership is a sparse set — `hexes` maps each member coordinate
 * key to `true`, mirroring how the document stores painted hexes — so a single
 * coordinate carries `true` in as many regions as own it. Regions overlap
 * freely, and the set is independent of whether a Hex is painted there.
 */
export const regionSchema = z.object({
  /** Stable identifier the editor mints; referenced by the armed region tool. */
  id: z.string(),
  /** Human-facing name (e.g. "The Kingdom of Avalon"). */
  name: z.string(),
  /** The `#rrggbb` colour the renderer strokes the region's perimeter border in. */
  color: hexColorSchema,
  /** The member coordinate keys, each mapped to `true` — a JSON-friendly set. */
  hexes: z.record(z.string(), z.literal(true)),
});

/** A point in world/pixel space — the anchor a free-positioned Label sits at. */
const pointSchema = z.object({ x: z.number(), y: z.number() });

/**
 * A Label: free-positioned cartographic text drawn on the map, *not* snapped to
 * the hex grid (CONTEXT.md → Label, issue #10). Anchored at a world-space
 * `position`, drawn at `size` (world pixels at zoom 1), with an optional
 * `rotation` in degrees. Distinct from an entity's `name`, which the renderer
 * may draw but which is not a Label.
 */
export const labelSchema = z.object({
  /** Stable identifier the editor mints; referenced by selection and edits. */
  id: z.string(),
  /** The text drawn on the map (e.g. "The Whisperwood"). */
  text: z.string(),
  /** The world-space point the text is anchored (and centred) on. */
  position: pointSchema,
  /** The drawn text height in world pixels at zoom 1; must be positive. */
  size: z.number().positive(),
  /** Clockwise rotation in degrees; absent (treated as 0) when unrotated. */
  rotation: z.number().optional(),
});

/**
 * The Hex Map document. `hexes` is sparse: a coordinate key (`coordKey`) is
 * present only where the user painted, absent everywhere else (Void). `regions`
 * and `labels` default to empty so documents saved before they existed still
 * parse and gain the fields on load (issues #8, #10).
 */
export const hexMapSchema = z.object({
  hexes: z.record(z.string(), hexSchema),
  regions: z.array(regionSchema).default([]),
  labels: z.array(labelSchema).default([]),
});

/** A terrain id from the built-in palette — the literal union of every id. */
export type TerrainId = (typeof terrainPalette)[number]['id'];
/** A feature id from the built-in library — the literal union of every id. */
export type FeatureId = (typeof featureLibrary)[number]['id'];

/**
 * The human label for a terrain id, or `undefined` if it is not a built-in. Each
 * caller applies its own fallback (e.g. the raw id, or `null` for "no hex").
 */
export function terrainLabel(id: TerrainId): string | undefined {
  return terrainPalette.find((t) => t.id === id)?.label;
}

/** The human label for a feature id, or `undefined` if it is not a built-in. */
export function featureLabel(id: FeatureId): string | undefined {
  return featureLibrary.find((f) => f.id === id)?.label;
}
/** A single painted hex's content. */
export type Hex = z.infer<typeof hexSchema>;
/** A named, colored grouping of hex coordinates that overlaps others freely. */
export type Region = z.infer<typeof regionSchema>;
/** A free-positioned text element drawn on the map, off the hex grid. */
export type Label = z.infer<typeof labelSchema>;
/** The whole document held by the editor and persisted to the backend. */
export type HexMap = z.infer<typeof hexMapSchema>;

/** A brand-new map: an empty plane, every coordinate Void, no regions or labels. */
export function emptyHexMap(): HexMap {
  return { hexes: {}, regions: [], labels: [] };
}

/**
 * The {@link Region} with `id` in `map`, or `undefined` if none has it. The one
 * region-by-id lookup the store (selection self-heal, membership edits) and the
 * renderer (selection highlight) share, so "find a region" lives in one place
 * rather than being re-derived as `regions.find(...)` at each call site.
 */
export function regionById(map: HexMap, id: string): Region | undefined {
  return map.regions.find((r) => r.id === id);
}
