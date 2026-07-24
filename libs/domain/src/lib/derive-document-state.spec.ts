import * as z from 'zod';
import { EntityDocument, Field, fieldSchemaSchema } from './field';
import { deriveDocumentState } from './derive-document-state';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';

/** A terse {@link Field} builder — `id` *is* the document key it lenses (ADR-0056), bare for the specs. */
const field = (id: string, kind: string): Field => ({
  id,
  ...fieldSchemaSchema.parse({ label: id, dataType: { kind } }),
});

/**
 * Stand-ins for a plugin's **Structured Data Type**s: the domain bundles none of its own (ADR-0050),
 * so a spec declares them and threads them in as a host does. `PROSE` stands for `core.datatype.rich-content`,
 * which contributes text *and* descriptor-bearing links through this generic path (ADR-0051).
 */
const BOARD = defineStructuredDataType({
  id: 'test.datatype.board',
  valueSchema: z.object({ tiles: z.array(z.object({ entityId: z.string(), name: z.string().optional() })) }),
  empty: () => ({ tiles: [] }),
  harvestEdges: (board) =>
    board.tiles.map((tile) => ({
      targetKind: 'entity' as const,
      targetId: tile.entityId,
      descriptor: null,
      decor: false,
    })),
  extractText: (board) =>
    board.tiles
      .map((tile) => tile.name ?? '')
      .join(' ')
      .trim(),
});
const LINKS = defineStructuredDataType({
  id: 'test.datatype.links',
  valueSchema: z.array(z.object({ entityId: z.string(), descriptor: z.string().nullish() })),
  empty: () => [],
  harvestEdges: (links) =>
    links.map((l) => ({
      targetKind: 'entity' as const,
      targetId: l.entityId,
      descriptor: l.descriptor ?? null,
      decor: false,
    })),
});
const PROSE = defineStructuredDataType({
  id: 'test.datatype.prose',
  valueSchema: z.object({ text: z.string() }),
  empty: () => ({ text: '' }),
  extractText: (prose) => prose.text,
});
/** A structured data-type harvesting a facet dimension (ADR-0055). */
const STATBLOCK = defineStructuredDataType({
  id: 'test.datatype.stat-block',
  valueSchema: z.object({ cr: z.number() }),
  empty: () => ({ cr: 0 }),
  facetDimensions: [{ key: 'cr', label: 'CR', dataType: { kind: 'number' } }],
  harvestFacets: (sb) => [{ key: 'cr', value: String(sb.cr), num: sb.cr }],
});

const DATA_TYPES = structuredDataTypeSet([BOARD, LINKS, PROSE, STATBLOCK]);
const boardField = field('board', 'test.datatype.board');
const linksField = field('links', 'test.datatype.links');
const proseField = field('prose', 'test.datatype.prose');
const statField = field('stats', 'test.datatype.stat-block');

const derive = (doc: EntityDocument, fields: readonly Field[] = [], dataTypes = DATA_TYPES) =>
  deriveDocumentState(doc, fields, dataTypes);

const links = (...ls: { entityId: string; descriptor?: string | null }[]): EntityDocument => ({ links: ls });

describe('deriveDocumentState — the one document-derived state pass (ADR-0046, ADR-0051, ADR-0055)', () => {
  describe('edges: grain is (target, descriptor)', () => {
    it('keeps two descriptors to the same target as two edges', () => {
      expect(
        derive(links({ entityId: 'mira', descriptor: 'spouse' }, { entityId: 'mira', descriptor: 'rival' }), [
          linksField,
        ]).edges,
      ).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'spouse', decor: false },
        { targetKind: 'entity', targetId: 'mira', descriptor: 'rival', decor: false },
      ]);
    });

    it('folds a repeated link into one edge case-insensitively, keeping the authored spelling', () => {
      expect(
        derive(
          links(
            { entityId: 'mira', descriptor: 'Spouse' },
            { entityId: 'mira', descriptor: 'spouse' },
            { entityId: 'mira', descriptor: null },
          ),
          [linksField],
        ).edges,
      ).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Spouse', decor: false },
        { targetKind: 'entity', targetId: 'mira', descriptor: null, decor: false },
      ]);
    });
  });

  describe('edges: Entity-Link Field values (#190)', () => {
    const lair = field('lair', 'entityLink');

    it('emits an edge per Entity-Link Field value, resolved against the Entity fields', () => {
      const doc: EntityDocument = { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } };
      expect(derive(doc, [lair]).edges).toEqual([
        { targetKind: 'entity', targetId: 'whisperwood', descriptor: null, decor: false },
      ]);
    });

    it('reads no Field edge without the resolved fields', () => {
      const doc: EntityDocument = { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } };
      expect(derive(doc).edges).toEqual([]);
    });

    it('collapses a Field link and a structured-field link to the same target into one edge', () => {
      const doc: EntityDocument = {
        lair: { entityId: 'riverbend' },
        board: { tiles: [{ entityId: 'riverbend' }, { entityId: 'harbour' }] },
      };
      expect(derive(doc, [lair, boardField]).edges).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'harbour', descriptor: null, decor: false },
      ]);
    });

    it('ignores a blank or ill-typed Field value', () => {
      expect(derive({ lair: { label: 'Ghost' } }, [lair]).edges).toEqual([]);
    });
  });

  describe('edges: Decor Link classification (ADR-0069)', () => {
    const lair = field('lair', 'entityLink');
    const portrait: Field = { ...field('portrait', 'entityLink'), decor: true };

    it('marks a `decor` Field’s edge as decor and a plain link’s as semantic', () => {
      const doc: EntityDocument = { lair: { entityId: 'riverbend' }, portrait: { entityId: 'cover-art' } };
      expect(derive(doc, [lair, portrait]).edges).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'cover-art', descriptor: null, decor: true },
      ]);
    });

    it('upgrades a merged edge out of decor when any producer links it semantically', () => {
      // A Thumbnail (decor) and a prose link to the same target collapse to one edge: the semantic reason
      // to link wins, so the target is not subdued as decor. `LINKS` harvests semantic edges.
      const doc: EntityDocument = { portrait: { entityId: 'mira' }, links: [{ entityId: 'mira' }] };
      expect(derive(doc, [portrait, linksField]).edges).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: null, decor: false },
      ]);
    });
  });

  describe('edges: Structured Data Type (ADR-0050)', () => {
    const board = (): EntityDocument => ({ board: { tiles: [{ entityId: 'riverbend' }, { entityId: 'harbour' }] } });

    it('takes the edges the data-type harvests from its own value', () => {
      expect(derive(board(), [boardField]).edges).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'harbour', descriptor: null, decor: false },
      ]);
    });

    it('harvests nothing when the kind is unregistered or the set is empty', () => {
      const typo = field('board', 'test.datatype.bord');
      expect(derive(board(), [boardField], NO_STRUCTURED_DATA_TYPES).edges).toEqual([]);
      expect(derive(board(), [typo]).edges).toEqual([]);
    });

    it('harvests nothing from a malformed value at rest, rather than throwing', () => {
      expect(derive({ board: 'garbage' }, [boardField]).edges).toEqual([]);
    });
  });

  describe('descriptors: the case-folded vocabulary projected off the edge set', () => {
    it('projects the distinct, case-folded descriptors the edges carry', () => {
      const doc = links({ entityId: 'mira', descriptor: 'Spouse' }, { entityId: 'kade', descriptor: 'rival' });
      expect(derive(doc, [linksField]).descriptors).toEqual(['spouse', 'rival']);
    });

    it('is empty when no edge carries a descriptor', () => {
      expect(derive({ lair: { entityId: 'whisperwood' } }, [field('lair', 'entityLink')]).descriptors).toEqual([]);
    });
  });

  describe('searchText: every structured contribution, single-spaced', () => {
    it("asks each resolved Structured Data Type for the text its Field's value carries", () => {
      const doc: EntityDocument = {
        prose: { text: 'A ruined keep.' },
        board: {
          tiles: [
            { entityId: 'a', name: 'Riverbend' },
            { entityId: 'b', name: 'Harbour' },
          ],
        },
      };
      expect(derive(doc, [proseField, boardField]).searchText).toBe('A ruined keep. Riverbend Harbour');
    });

    it('is empty with no type context', () => {
      expect(derive({ prose: { text: 'unseen' } }).searchText).toBe('');
    });

    it('takes no text from a malformed value at rest, rather than throwing', () => {
      const doc: EntityDocument = { prose: { text: 'Still findable.' }, board: 'garbage' };
      expect(derive(doc, [proseField, boardField]).searchText).toBe('Still findable.');
    });
  });

  describe('fieldFacets: scalar Fields and harvested dimensions in one flat key-space (ADR-0048, ADR-0055)', () => {
    it('materialises each facetable scalar Field value, tagging a number with its numeric form', () => {
      const cr = field('cr', 'number');
      const size = {
        id: 'size',
        ...fieldSchemaSchema.parse({
          label: 'size',
          dataType: { kind: 'enum', options: ['small', 'large'] },
          facetable: true,
        }),
      };
      const derived = derive({ cr: 10, size: 'large' }, [{ ...cr, facetable: true }, size]).fieldFacets;
      expect(derived).toContainEqual({ key: 'cr', value: '10', num: 10 });
      expect(derived).toContainEqual({ key: 'size', value: 'large', num: null });
    });

    it('harvests a structured Data Type dimension into the same key-space', () => {
      expect(derive({ stats: { cr: 5 } }, [statField]).fieldFacets).toContainEqual({ key: 'cr', value: '5', num: 5 });
    });
  });

  describe('importSource: the reserved hexly.source key (ADR-0060)', () => {
    const SOURCE = { importer: 'draw-steel.importer.monsters', sourceId: 'goblin', rev: 'sha-abc' };

    it('surfaces a well-formed Import Source, needing neither Fields nor data-types', () => {
      expect(derive({ 'hexly.source': SOURCE }, []).importSource).toEqual(SOURCE);
    });

    it('is null when the document carries no stamp', () => {
      expect(derive({ prose: { text: 'x' } }, [proseField]).importSource).toBeNull();
    });

    /** Forward-only: an ill-shaped stamp reads as un-stamped, never throws. */
    it('is null when the stamp is malformed', () => {
      expect(derive({ 'hexly.source': { importer: 'draw-steel.importer.monsters' } }, []).importSource).toBeNull();
    });
  });

  describe('thumbnailEntityId: the Thumbnail Field designation (ADR-0066)', () => {
    // The asset plugin owns the id; the domain is told which key to pick, never hardcoding it.
    const THUMB = 'core.field.thumbnail';
    const thumbField = field(THUMB, 'entityLink');
    const deriveThumb = (doc: EntityDocument, fields: readonly Field[] = [thumbField]) =>
      deriveDocumentState(doc, fields, DATA_TYPES, { thumbnailFieldId: THUMB }).thumbnailEntityId;

    it('materialises the designated target entityId from the entityLink value', () => {
      expect(deriveThumb({ [THUMB]: { entityId: 'portrait-1', label: 'Portrait' } })).toBe('portrait-1');
    });

    it('is null when no thumbnail id is named (the asset plugin disabled)', () => {
      expect(
        deriveDocumentState({ [THUMB]: { entityId: 'portrait-1' } }, [thumbField], DATA_TYPES).thumbnailEntityId,
      ).toBeNull();
    });

    it('is null when the field is absent, blank, or ill-typed (forward-only, never throws)', () => {
      expect(deriveThumb({})).toBeNull();
      expect(deriveThumb({ [THUMB]: { entityId: '', label: '' } })).toBeNull();
      expect(deriveThumb({ [THUMB]: 'not-a-link' })).toBeNull();
      expect(deriveThumb({ [THUMB]: { label: 'orphan' } })).toBeNull();
    });

    it('is null when the key resolves to no registered Field (unresolved key is dropped)', () => {
      // No Field named for the key → not in the effective set → no designation, value sits inert.
      expect(deriveThumb({ [THUMB]: { entityId: 'portrait-1' } }, [])).toBeNull();
    });

    it('still harvests the designation as an ordinary link edge (usage surfaces by name)', () => {
      const edges = deriveDocumentState(
        { [THUMB]: { entityId: 'portrait-1', label: 'Portrait' } },
        [thumbField],
        DATA_TYPES,
        { thumbnailFieldId: THUMB },
      ).edges;
      expect(edges).toEqual([{ targetKind: 'entity', targetId: 'portrait-1', descriptor: null, decor: false }]);
    });
  });

  describe('composition: one call yields every derived index for one document', () => {
    it('returns edges, descriptors, searchText and fieldFacets together', () => {
      const doc: EntityDocument = {
        prose: { text: 'The keep at Riverbend.' },
        links: [{ entityId: 'mira', descriptor: 'Spouse' }],
        stats: { cr: 5 },
      };
      const state = derive(doc, [proseField, linksField, statField]);
      expect(state.searchText).toBe('The keep at Riverbend.');
      expect(state.edges).toEqual([{ targetKind: 'entity', targetId: 'mira', descriptor: 'Spouse', decor: false }]);
      expect(state.descriptors).toEqual(['spouse']);
      expect(state.fieldFacets).toContainEqual({ key: 'cr', value: '5', num: 5 });
    });
  });
});
