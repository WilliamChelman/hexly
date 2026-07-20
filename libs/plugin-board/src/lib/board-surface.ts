/**
 * The Board Surface document: the free-positioned 2D plane a user composes (CONTEXT.md → Board Surface,
 * Board Element, #263). Its substance is a z-ordered set of **Board Elements**, each carrying geometry
 * (a position and a size) and an explicit integer z-order, plus kind-specific data. The value of the
 * `core.datatype.board-surface` **Structured Data Type** (see `board-surface-type.ts`).
 *
 * Framework-free by construction: every mutation is a pure document transition, so the element and
 * z-order helpers are unit-testable without a browser.
 */

import { richContentSchema } from '@hexly/plugin-content';
import { z } from 'zod';

// Coordinates and extents are `.finite()`: a non-finite value (a bad inspector entry, `1e400`) survives
// in memory but `JSON.stringify(Infinity) === "null"`, so it persists as `null` and fails the reload
// parse — the whole board would open empty and be overwritten. Rejecting it here bars it from a surface at
// rest regardless of caller.
/** A point in world/pixel space — an element's top-left anchor on the plane. */
export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

/** An element's drawn extent in world pixels; both dimensions must be positive. */
export const sizeSchema = z.object({ width: z.number().positive().finite(), height: z.number().positive().finite() });

/**
 * The fields every Board Element shares (CONTEXT.md → Board Element): a stable `id` the editor mints,
 * geometry (`position`, `size`), and an explicit integer `z` — the stacking key, higher sits on top. The
 * kind-specific schemas below extend this; `z` is a plain integer so stacking is deterministic and the
 * reorder helpers can renumber it freely.
 */
const baseElementShape = {
  id: z.string(),
  position: pointSchema,
  size: sizeSchema,
  z: z.number().int(),
} as const;

/**
 * A **Box** element: a plain placed rectangle carrying nothing beyond the shared geometry and z-order.
 * The **minimal static element** that proves the surface-agnostic element pipeline (Seam B, #267) — it
 * has no kind-specific data of its own, so the Tool/Selection/Inspector/z-order machinery can be built
 * and exercised end-to-end before the Text Block (#268) and Image (#269) kinds wire real content on.
 */
export const boxElementSchema = z.object({
  ...baseElementShape,
  kind: z.literal('box'),
});

/** An **Image** element: geometry plus the World **Asset** URL it displays. Always static (never armed). */
export const imageElementSchema = z.object({
  ...baseElementShape,
  kind: z.literal('image'),
  /** The served capability URL of the World Asset this element displays. */
  assetUrl: z.string(),
  // Whether resize-handle drags keep the picture's aspect ratio (CONTEXT.md → Image, the selection
  // controls). A property of the element, so it survives reload/undo; `.default(false)` keeps every
  // pre-existing surface (no such field) parsing, defaulting the lock off.
  lockRatio: z.boolean().default(false),
});

/**
 * An **Embed** element: geometry plus the target Entity and the chosen **View** it transcludes (ADR-0062).
 * `viewInstance` is the serialized View-instance key (`core.view.map:core.field.grid`) naming which View of the
 * target renders in place; an empty string means "the target's default View".
 */
export const embedElementSchema = z.object({
  ...baseElementShape,
  kind: z.literal('embed'),
  /** The Entity this Embed renders — an **Entity Link**, harvested as a descriptor-less edge. */
  targetEntityId: z.string(),
  /** The chosen View's instance key (see `web-entity`'s `viewInstanceKey`); `''` selects the default View. */
  viewInstance: z.string().default(''),
});

/**
 * A **Text Block** element: geometry plus a `core.datatype.rich-content` value edited with the same editor as an
 * Entity's RichContent. Its prose feeds the Board's searchable text and its inline **Entity Links** the link
 * harvest (CONTEXT.md → Text Block).
 */
export const textElementSchema = z.object({
  ...baseElementShape,
  kind: z.literal('text'),
  /** The rich text authored on the surface — a `core.datatype.rich-content` value. */
  content: richContentSchema,
});

/** A placed thing on the surface — one of the element kinds, discriminated by `kind`. */
export const boardElementSchema = z.discriminatedUnion('kind', [
  boxElementSchema,
  imageElementSchema,
  embedElementSchema,
  textElementSchema,
]);

/**
 * The Board Surface document: an ordered collection of Board Elements. The array order is insertion
 * order and is not the stacking order — stacking is read off each element's `z` (see {@link stackingOrder}).
 */
export const boardSurfaceSchema = z.object({
  elements: z.array(boardElementSchema).default([]),
});

/** A point in world space — an element's top-left anchor. */
export type Point = z.infer<typeof pointSchema>;
/** An element's drawn extent in world pixels. */
export type Size = z.infer<typeof sizeSchema>;
/** A Box Board Element — the minimal static element (Seam B, #267). */
export type BoxElement = z.infer<typeof boxElementSchema>;
/** An Image Board Element. */
export type ImageElement = z.infer<typeof imageElementSchema>;
/** An Embed Board Element. */
export type EmbedElement = z.infer<typeof embedElementSchema>;
/** A Text Block Board Element. */
export type TextElement = z.infer<typeof textElementSchema>;
/** Any Board Element. */
export type BoardElement = z.infer<typeof boardElementSchema>;
/** The whole surface document held by the editor and persisted to the backend. */
export type BoardSurface = z.infer<typeof boardSurfaceSchema>;

/** A brand-new surface: an empty plane, no elements. What the data-type's `empty()` mints. */
export function emptyBoardSurface(): BoardSurface {
  return { elements: [] };
}

/** The z one above the current top of the stack — where a newly added element lands so it appears on top. */
function topZ(surface: BoardSurface): number {
  return surface.elements.reduce((max, element) => Math.max(max, element.z + 1), 0);
}

/**
 * Add an element to the surface, on top of the stack (CONTEXT.md → Board Element; user story 21). The
 * caller mints the id and geometry; the helper stamps `z` above the current top, so a freshly placed
 * element is never hidden behind existing ones. Any `z` on the incoming element is ignored.
 */
export function addElement(surface: BoardSurface, element: BoardElement): BoardSurface {
  return { ...surface, elements: [...surface.elements, { ...element, z: topZ(surface) }] };
}

/** Remove the element with `id`; a no-op (same document) if none has it. */
export function removeElement(surface: BoardSurface, id: string): BoardSurface {
  return { ...surface, elements: surface.elements.filter((element) => element.id !== id) };
}

/** The elements in stacking order, bottom (lowest `z`) first; ties break by insertion order (stable sort). */
export function stackingOrder(surface: BoardSurface): BoardElement[] {
  return [...surface.elements].sort((a, b) => a.z - b.z);
}

/** Bring the `id` element one step up the stack — swapping it above the element directly on top of it. */
export function bringForward(surface: BoardSurface, id: string): BoardSurface {
  return reorder(surface, id, (order, index) => swap(order, index, index + 1));
}

/** Send the `id` element one step down the stack — swapping it below the element directly under it. */
export function sendBackward(surface: BoardSurface, id: string): BoardSurface {
  return reorder(surface, id, (order, index) => swap(order, index, index - 1));
}

/** Move the `id` element to the very top of the stack. */
export function bringToFront(surface: BoardSurface, id: string): BoardSurface {
  return reorder(surface, id, (order, index) => [...without(order, index), order[index]]);
}

/** Move the `id` element to the very bottom of the stack. */
export function sendToBack(surface: BoardSurface, id: string): BoardSurface {
  return reorder(surface, id, (order, index) => [order[index], ...without(order, index)]);
}

/**
 * Reposition the `id` element within the stacking order via `move`, then renumber every element's `z` to
 * its new rank (0-based). Renumbering keeps `z` a dense, gap-free integer sequence so repeated reorders
 * never drift; a no-op — the input document, by reference — if none has the id, or the move leaves the
 * order unchanged with `z` already dense (so a boundary action like `bringToFront` on the top element
 * records no undo step / autosave through Immer, whose diff would otherwise see freshly-rebuilt objects).
 */
function reorder(
  surface: BoardSurface,
  id: string,
  move: (order: BoardElement[], index: number) => BoardElement[],
): BoardSurface {
  const order = stackingOrder(surface);
  const index = order.findIndex((element) => element.id === id);
  if (index === -1) return surface;
  const moved = move(order, index);
  const rankById = new Map(moved.map((element, rank) => [element.id, rank]));
  if (surface.elements.every((element) => rankById.get(element.id) === element.z)) return surface;
  return {
    ...surface,
    elements: surface.elements.map((element) => ({ ...element, z: rankById.get(element.id) ?? element.z })),
  };
}

/** A copy of `order` with the elements at `a` and `b` swapped; unchanged if `b` is out of range. */
function swap(order: BoardElement[], a: number, b: number): BoardElement[] {
  if (b < 0 || b >= order.length) return order;
  const next = [...order];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** A copy of `order` with the element at `index` removed. */
function without(order: BoardElement[], index: number): BoardElement[] {
  return order.filter((_, i) => i !== index);
}
