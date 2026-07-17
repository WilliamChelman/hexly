import { z } from 'zod';
import { fieldSchemaSchema, Field, EntityDocument } from './field';
import { harvestEdges } from './entity-edges';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';

/** A terse {@link Field} builder — `id` *is* the document key it lenses (ADR-0056), bare for the specs. */
const field = (id: string, kind: string): Field => ({
  id,
  ...fieldSchemaSchema.parse({ label: id, dataType: { kind } }),
});

/** `harvestEdges` takes the resolved Fields and the data-type set explicitly; most cases need neither. */
function harvest(
  doc: EntityDocument,
  fields: readonly Field[] = [],
  dataTypes = NO_STRUCTURED_DATA_TYPES,
): ReturnType<typeof harvestEdges> {
  return harvestEdges(doc, fields, dataTypes);
}

/**
 * A stand-in for a plugin's **Structured Data Type**: the domain bundles none of its own
 * (ADR-0050), so a spec declares one and threads it in as a host does. A placement expresses no
 * relationship, so it carries no Link Descriptor.
 */
const BOARD = defineStructuredDataType({
  id: 'test.board',
  valueSchema: z.object({ tiles: z.array(z.object({ entityId: z.string() })) }),
  empty: () => ({ tiles: [] }),
  harvestEdges: (board) =>
    board.tiles.map((tile) => ({ targetKind: 'entity' as const, targetId: tile.entityId, descriptor: null })),
});

/**
 * A second stand-in whose value carries descriptors — the shape `core.rich-content`'s prose links have
 * (ADR-0051). It lets this spec exercise the domain's own edge-grain and dedup logic without knowing
 * anything about prose.
 */
const LINKS = defineStructuredDataType({
  id: 'test.links',
  valueSchema: z.array(z.object({ entityId: z.string(), descriptor: z.string().nullish() })),
  empty: () => [],
  harvestEdges: (links) =>
    links.map((l) => ({ targetKind: 'entity' as const, targetId: l.entityId, descriptor: l.descriptor ?? null })),
});

const DATA_TYPES = structuredDataTypeSet([BOARD, LINKS]);
const boardField = field('board', 'test.board');
const linksField = field('links', 'test.links');

/** A doc whose `board` Field holds two placements. */
const board = (): EntityDocument => ({ board: { tiles: [{ entityId: 'riverbend' }, { entityId: 'harbour' }] } });
/** Harvest a structured value exactly as the write path does: through the Field its type declares. */
const harvestBoard = (doc: EntityDocument) => harvest(doc, [boardField], DATA_TYPES);

/** A doc whose `links` Field holds the given descriptor-bearing links. */
const links = (...ls: { entityId: string; descriptor?: string | null }[]): EntityDocument => ({ links: ls });
const harvestLinks = (doc: EntityDocument) => harvest(doc, [linksField], DATA_TYPES);

describe('harvestEdges (#179, ADR-0046, ADR-0051)', () => {
  /**
   * Nothing records *where* a link was expressed (ADR-0046 rejects a `sourceKind` column), so a
   * prose mention and a map placement of the same target are the same edge — while two descriptors
   * to that target are two. The grain lives in the domain's `add`, whatever data-type fed the edge.
   */
  describe('the grain is (target, descriptor)', () => {
    it('keeps two descriptors to the same target as two edges', () => {
      expect(
        harvestLinks(links({ entityId: 'mira', descriptor: 'spouse' }, { entityId: 'mira', descriptor: 'rival' })),
      ).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'spouse' },
        { targetKind: 'entity', targetId: 'mira', descriptor: 'rival' },
      ]);
    });

    /**
     * Descriptors collapse case-insensitively — `"Spouse"` and `"spouse"` name one relationship —
     * but the edge keeps the descriptor **as authored** (a link renders the raw attr in the prose),
     * so a folded edge would put two spellings of one descriptor side by side. Case-folding belongs
     * to the `::` vocabulary, which {@link descriptorsSchema} applies where it is built.
     */
    it('folds a repeated link into one edge case-insensitively, keeping the authored spelling', () => {
      expect(
        harvestLinks(
          links(
            { entityId: 'mira', descriptor: 'Spouse' },
            { entityId: 'mira', descriptor: 'spouse' },
            { entityId: 'mira', descriptor: null },
          ),
        ),
      ).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Spouse' },
        { targetKind: 'entity', targetId: 'mira', descriptor: null },
      ]);
    });
  });

  /**
   * A typed Entity-Link Field value (#190) is an edge to its target, descriptor-less like a map
   * placement — harvested against the Entity's resolved `fields`, straight off the EntityDocument map.
   */
  describe('Entity-Link Field edges (#190)', () => {
    const lair = field('lair', 'entityLink');

    it('emits an edge per Entity-Link Field value, resolved against the Entity fields', () => {
      const doc: EntityDocument = { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } };
      expect(harvest(doc, [lair])).toEqual([{ targetKind: 'entity', targetId: 'whisperwood', descriptor: null }]);
    });

    it('reads no Field edge without the resolved fields (the default)', () => {
      const doc: EntityDocument = { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } };
      expect(harvest(doc)).toEqual([]);
    });

    it('collapses a Field link and a structured-field link to the same target into one edge', () => {
      const doc: EntityDocument = { lair: { entityId: 'riverbend', label: 'Riverbend' }, board: board().board };
      expect(harvest(doc, [lair, boardField], DATA_TYPES)).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
      ]);
    });

    it('ignores a blank or ill-typed Field value — inert, never an edge', () => {
      const doc: EntityDocument = { lair: { label: 'Ghost' } };
      expect(harvest(doc, [lair])).toEqual([]);
    });
  });

  /** A Field of a **Structured Data Type** harvests its own edges (ADR-0050) — a placement on a plugin's board. */
  describe('Structured Data Type edges (ADR-0050)', () => {
    it('takes the edges the data-type harvests from its own value', () => {
      expect(harvestBoard(board())).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
      ]);
    });

    it('reads no structured edge without the Field resolved — an Entity is its Fields, always', () => {
      // With no type context there is no `board` Field, so there is nothing to harvest. The write path
      // always resolves the Entity's types.
      expect(harvest(board())).toEqual([]);
    });

    it('harvests nothing when the kind is unregistered, or the set is empty', () => {
      const typo = field('board', 'test.bord');
      expect(harvest(board(), [boardField])).toEqual([]);
      expect(harvest(board(), [typo], DATA_TYPES)).toEqual([]);
    });

    it('harvests nothing from a malformed value at rest, rather than throwing', () => {
      const doc: EntityDocument = { board: 'garbage' };
      expect(harvestBoard(doc)).toEqual([]);
    });
  });
});
