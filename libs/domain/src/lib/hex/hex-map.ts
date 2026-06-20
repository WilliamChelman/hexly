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
  { id: 'grass', label: 'Grassland', fill: '--terrain-grass' },
  { id: 'forest', label: 'Forest', fill: '--terrain-forest' },
  { id: 'ocean', label: 'Ocean', fill: '--terrain-ocean' },
  { id: 'mountain', label: 'Mountains', fill: '--terrain-mountain' },
  { id: 'desert', label: 'Desert', fill: '--terrain-desert' },
] as const satisfies readonly Terrain[];

/**
 * Build a Zod enum from a palette's ids. Centralizes the one fragile
 * non-empty-tuple cast Zod requires so it lives in exactly one place; the
 * inferred literal types and runtime enum are identical to inlining it.
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
 * A painted Hex. Carries exactly one Terrain, plus at most one Feature
 * (CONTEXT.md → Hex). `feature` is optional and absent unless one is placed.
 */
export const hexSchema = z.object({
  terrain: terrainIdSchema,
  feature: featureRefSchema.optional(),
});

/** A six-digit `#rrggbb` colour, the form a Region's user-chosen tint is stored in. */
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
  /** The translucent tint the renderer fills member hexes with, as `#rrggbb`. */
  color: hexColorSchema,
  /** The member coordinate keys, each mapped to `true` — a JSON-friendly set. */
  hexes: z.record(z.string(), z.literal(true)),
});

/**
 * The Hex Map document. `hexes` is sparse: a coordinate key (`coordKey`) is
 * present only where the user painted, absent everywhere else (Void). `regions`
 * defaults to empty so documents saved before regions existed still parse and
 * gain the field on load (issue #8).
 */
export const hexMapSchema = z.object({
  hexes: z.record(z.string(), hexSchema),
  regions: z.array(regionSchema).default([]),
});

/** A terrain id from the built-in palette — the literal union of every id. */
export type TerrainId = (typeof terrainPalette)[number]['id'];
/** A feature id from the built-in library — the literal union of every id. */
export type FeatureId = (typeof featureLibrary)[number]['id'];
/** A single painted hex's content. */
export type Hex = z.infer<typeof hexSchema>;
/** A named, colored grouping of hex coordinates that overlaps others freely. */
export type Region = z.infer<typeof regionSchema>;
/** The whole document held by the editor and persisted to the backend. */
export type HexMap = z.infer<typeof hexMapSchema>;

/** A brand-new map: an empty plane, every coordinate Void, with no regions. */
export function emptyHexMap(): HexMap {
  return { hexes: {}, regions: [] };
}
