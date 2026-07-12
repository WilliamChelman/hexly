import { z } from 'zod';
import { emptyContent, EntityBody, tiptapContent } from './entity';
import { fieldSchemaSchema, FieldSchema } from './field';
import { emptyHexMap, HexMap } from './hex/hex-map';
import { HEX_GRID_FIELD } from './hex/hex-grid';
import { CORE_STRUCTURED_DATA_TYPES } from './plugin-type';
import { harvestEdges } from './entity-edges';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';

/** `harvestEdges` takes the resolved Fields and the data-type set explicitly; most cases need neither. */
function harvest(
  body: EntityBody,
  fields: readonly FieldSchema[] = [],
  dataTypes = NO_STRUCTURED_DATA_TYPES,
): ReturnType<typeof harvestEdges> {
  return harvestEdges(body, fields, dataTypes);
}

/** The core's own set — what the API composes and threads in, so a Hex Map's grid resolves. */
const CORE_DATA_TYPES = structuredDataTypeSet([...CORE_STRUCTURED_DATA_TYPES]);

/**
 * Harvest a Hex Map exactly as the write path does: its grid is the `core.hex-grid` **Structured
 * Field** `core.hexmap` declares, so its placements come back through the generic Field path — the
 * harvester itself carries no hex-shaped branch (ADR-0050).
 */
function harvestMap(body: EntityBody) {
  return harvest(body, [HEX_GRID_FIELD], CORE_DATA_TYPES);
}

/** Content holding the given `entityLink` attrs, wrapped in a paragraph. */
function prose(...links: Record<string, unknown>[]) {
  return tiptapContent({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: links.map((attrs) => ({ type: 'entityLink', attrs })),
      },
    ],
  });
}

/** A body whose Content holds the given `entityLink` attrs. */
function note(...links: Record<string, unknown>[]): EntityBody {
  return { content: prose(...links) };
}

/** A Hex Map body: its grid at the `grid` Metadata key, an empty plane plus the test's overrides. */
function hexmap(map: Partial<HexMap> = {}, content = emptyContent()): EntityBody {
  return { content, metadata: { grid: { ...emptyHexMap(), ...map } } };
}

describe('harvestEdges (#179, ADR-0046)', () => {
  it('reads a content entityLink as an edge to that Entity, carrying its Link Descriptor', () => {
    const body = note({
      entityId: 'mira',
      label: 'Mira',
      descriptor: 'spouse',
    });

    expect(harvest(body)).toEqual([{ targetKind: 'entity', targetId: 'mira', descriptor: 'spouse' }]);
  });

  /**
   * A Hex, a Feature, and a Region each carry their own Entity Link (a Label cannot).
   * A map placement expresses no relationship, so it never carries a Link Descriptor.
   */
  it('reads a hex, a feature, and a region link as descriptor-less edges', () => {
    const body = hexmap({
      hexes: {
        '0,0': { terrain: 'grass', entityId: 'harbour' },
        '1,0': {
          terrain: 'grass',
          feature: { ref: 'settlement', entityId: 'riverbend' },
        },
      },
      regions: [
        {
          id: 'r1',
          name: 'Avalon',
          color: '#aabbcc',
          hexes: {},
          entityId: 'kingdom-of-avalon',
        },
      ],
    });

    expect(harvestMap(body)).toEqual(
      expect.arrayContaining([
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        {
          targetKind: 'entity',
          targetId: 'kingdom-of-avalon',
          descriptor: null,
        },
      ]),
    );
    expect(harvestMap(body)).toHaveLength(3);
  });

  it('reads no map edge without the grid Field resolved — a Hex Map is its Fields, like any Entity', () => {
    // The counterpart of the Entity-Link Field case below: with no type context there is no `grid`
    // Field, so there is nothing to harvest. The write path always resolves the Entity's types.
    expect(harvest(hexmap({ hexes: { '0,0': { terrain: 'grass', entityId: 'harbour' } } }))).toEqual([]);
  });

  /**
   * Asset edges are groundwork for orphan detection / GC (ADR-0046) — harvested in the same
   * content walk, surfaced nowhere yet. An `image` pointing outside the Instance references no
   * Asset, so it is no edge.
   */
  it('reads an image at an Asset URL as an asset edge, and an external image as none', () => {
    const hash = 'a'.repeat(64);
    const body: EntityBody = {
      content: tiptapContent({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: `/assets/world-1/${hash}.png` } },
          { type: 'image', attrs: { src: 'https://example.test/cat.png' } },
        ],
      }),
    };

    expect(harvest(body)).toEqual([{ targetKind: 'asset', targetId: hash, descriptor: null }]);
  });

  /**
   * A wikilink the import could not resolve keeps `entityId: null` (and, from that path, a null
   * descriptor with it). It names no target, so it is no edge — and since the `::` vocabulary is
   * now a projection of the edge set, a descriptor stranded on such a link joins no vocabulary
   * either. A descriptor characterises a relationship *to* something; with no target there is no
   * relationship to characterise.
   */
  it('ignores an entityLink that names no target, descriptor or not', () => {
    expect(harvest(note({ entityId: null, label: 'Ghost', descriptor: 'rival' }))).toEqual([]);
    expect(harvest(note({ label: 'Ghost' }))).toEqual([]);
  });

  it('finds links nested deep in the Content tree', () => {
    const body: EntityBody = {
      content: tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'entityLink',
                        attrs: { entityId: 'e1', descriptor: 'liege' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    };

    expect(harvest(body)).toEqual([{ targetKind: 'entity', targetId: 'e1', descriptor: 'liege' }]);
  });

  /**
   * A Content snapshot is only walkable under a format this build knows — the same guard
   * `extractText` applies. A Field value is format-independent, so a Hex Map's placements
   * survive a Content format this build cannot read.
   */
  it('reads no Content edges under an unknown format tag, but still reads the map', () => {
    const alien = {
      format: 'prosemirror-v9',
      snapshot: { type: 'entityLink', attrs: { entityId: 'e1' } },
    };
    const body = hexmap(
      { hexes: { '0,0': { terrain: 'grass', entityId: 'harbour' } } },
      alien as unknown as EntityBody['content'],
    );

    expect(harvestMap(body)).toEqual([{ targetKind: 'entity', targetId: 'harbour', descriptor: null }]);
  });

  /**
   * The grain is `(targetKind, targetId, descriptor)`. Nothing records *where* a link was
   * expressed (ADR-0046 rejects a `sourceKind` column), so a prose mention and a map
   * placement of the same target are the same edge — while two descriptors to that target
   * are two.
   */
  describe('the grain is (target, descriptor)', () => {
    it('collapses a descriptor-less content link and a map placement of the same target', () => {
      const body = hexmap(
        { hexes: { '0,0': { terrain: 'grass', entityId: 'riverbend' } } },
        prose({ entityId: 'riverbend', label: 'Riverbend' }),
      );

      expect(harvestMap(body)).toEqual([{ targetKind: 'entity', targetId: 'riverbend', descriptor: null }]);
    });

    it('keeps two descriptors to the same target as two edges', () => {
      const body = note({ entityId: 'mira', descriptor: 'spouse' }, { entityId: 'mira', descriptor: 'rival' });

      expect(harvest(body)).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'spouse' },
        { targetKind: 'entity', targetId: 'mira', descriptor: 'rival' },
      ]);
    });

    /**
     * Descriptors collapse case-insensitively — `"Spouse"` and `"spouse"` name one relationship —
     * but the edge keeps the descriptor **as authored**. The Content link renders the raw attr in
     * the prose (`EntityLinkView`), so a folded edge would put two spellings of one descriptor
     * side by side on the same screen. Case-folding belongs to the `::` vocabulary, which
     * {@link descriptorsSchema} applies where it is built.
     */
    it('folds a repeated link into one edge case-insensitively, keeping the authored spelling', () => {
      const body = note(
        { entityId: 'mira', descriptor: 'Spouse' },
        { entityId: 'mira', descriptor: ' spouse ' },
        { entityId: 'mira', descriptor: '  ' },
        { entityId: 'mira' },
      );

      expect(harvest(body)).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Spouse' },
        { targetKind: 'entity', targetId: 'mira', descriptor: null },
      ]);
    });

    /** Surrounding whitespace is never part of a descriptor, whatever its case. */
    it('trims the authored descriptor', () => {
      expect(harvest(note({ entityId: 'mira', descriptor: '  Capital Of  ' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Capital Of' },
      ]);
    });
  });

  /**
   * A typed Entity-Link Field value (#190) is an edge to its target, descriptor-less like a map
   * placement — harvested against the Entity's resolved `fields`, from the Metadata map rather than
   * the Content snapshot. Feeds the same materialised index, so a Field relation appears in the
   * World Graph.
   */
  describe('Entity-Link Field edges (#190)', () => {
    const lair = fieldSchemaSchema.parse({ key: 'lair', label: 'Lair', dataType: { kind: 'entityLink' } });

    it('emits an edge per Entity-Link Field value, resolved against the Entity fields', () => {
      const body: EntityBody = {
        content: emptyContent(),
        metadata: { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } },
      };
      expect(harvest(body, [lair])).toEqual([{ targetKind: 'entity', targetId: 'whisperwood', descriptor: null }]);
    });

    it('reads no Field edge without the resolved fields (the default), so Content/map edges are unchanged', () => {
      const body: EntityBody = {
        content: prose({ entityId: 'mira', label: 'Mira' }),
        metadata: { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } },
      };
      expect(harvest(body)).toEqual([{ targetKind: 'entity', targetId: 'mira', descriptor: null }]);
    });

    it('collapses a Field link and a content link to the same target into one edge', () => {
      const body: EntityBody = {
        content: prose({ entityId: 'whisperwood', label: 'The Whisperwood' }),
        metadata: { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } },
      };
      expect(harvest(body, [lair])).toEqual([{ targetKind: 'entity', targetId: 'whisperwood', descriptor: null }]);
    });

    it('ignores a blank or ill-typed Field value — inert, never an edge', () => {
      const body: EntityBody = { content: emptyContent(), metadata: { lair: { label: 'Ghost' } } };
      expect(harvest(body, [lair])).toEqual([]);
    });
  });

  /** A **Structured Field** harvests its own edges (ADR-0050) — a Hex placed on a plugin's grid. */
  describe('Structured Field edges (ADR-0050)', () => {
    const BOARD = defineStructuredDataType({
      id: 'test.board',
      valueSchema: z.object({ tiles: z.array(z.object({ entityId: z.string() })) }),
      empty: () => ({ tiles: [] }),
      harvestEdges: (board) =>
        board.tiles.map((tile) => ({ targetKind: 'entity' as const, targetId: tile.entityId, descriptor: null })),
    });
    const DATA_TYPES = structuredDataTypeSet([BOARD]);
    const boardField = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: 'test.board' } });
    const board = (body: EntityBody = { content: emptyContent() }) => ({
      ...body,
      metadata: { board: { tiles: [{ entityId: 'riverbend' }, { entityId: 'harbour' }] } },
    });

    it('takes the edges the data-type harvests from its own value', () => {
      expect(harvest(board(), [boardField], DATA_TYPES)).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
      ]);
    });

    it('harvests nothing when the kind is unregistered, or the set is empty', () => {
      const typo = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: 'core.hex-gird' } });
      expect(harvest(board(), [boardField])).toEqual([]);
      expect(harvest(board(), [typo], DATA_TYPES)).toEqual([]);
    });

    it('harvests nothing from a malformed value at rest, rather than throwing', () => {
      const body: EntityBody = { content: emptyContent(), metadata: { board: 'garbage' } };
      expect(harvest(body, [boardField], DATA_TYPES)).toEqual([]);
    });

    it('collapses a structured edge and a content link to the same target into one edge', () => {
      const body = board({ content: prose({ entityId: 'riverbend', label: 'Riverbend' }) });
      expect(harvest(body, [boardField], DATA_TYPES)).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
      ]);
    });
  });
});
