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
 */
export const terrainPalette: readonly Terrain[] = [
  { id: 'grass', label: 'Grassland', fill: '--terrain-grass' },
  { id: 'forest', label: 'Forest', fill: '--terrain-forest' },
  { id: 'ocean', label: 'Ocean', fill: '--terrain-ocean' },
  { id: 'mountain', label: 'Mountains', fill: '--terrain-mountain' },
  { id: 'desert', label: 'Desert', fill: '--terrain-desert' },
];

/** A terrain id constrained to the built-in palette — the source of truth. */
export const terrainIdSchema = z.enum(
  terrainPalette.map((t) => t.id) as [string, ...string[]],
);

/** A painted Hex. Carries exactly one Terrain for now (CONTEXT.md → Hex). */
export const hexSchema = z.object({
  terrain: terrainIdSchema,
});

/**
 * The Hex Map document. `hexes` is sparse: a coordinate key (`coordKey`) is
 * present only where the user painted, absent everywhere else (Void).
 */
export const hexMapSchema = z.object({
  hexes: z.record(z.string(), hexSchema),
});

/** A terrain id from the built-in palette. */
export type TerrainId = z.infer<typeof terrainIdSchema>;
/** A single painted hex's content. */
export type Hex = z.infer<typeof hexSchema>;
/** The whole document held by the editor and persisted to the backend. */
export type HexMap = z.infer<typeof hexMapSchema>;

/** A brand-new map: an empty plane, every coordinate Void. */
export function emptyHexMap(): HexMap {
  return { hexes: {} };
}
