import { emptyContent, EntityBody, tiptapContent } from './entity';
import { emptyHexMap } from './hex/hex-map';
import { harvestEdges } from './entity-edges';

/** Content holding the given `entityLink` attrs, wrapped in a paragraph. */
function prose(...links: Record<string, unknown>[]) {
  return tiptapContent({
    type: 'doc',
    content: [
      { type: 'paragraph', content: links.map((attrs) => ({ type: 'entityLink', attrs })) },
    ],
  });
}

/** A `note` body whose Content holds the given `entityLink` attrs. */
function note(...links: Record<string, unknown>[]): EntityBody {
  return { type: 'note', content: prose(...links) };
}

/** A `hexmap` body: an empty plane plus whatever map payload the test overrides. */
function hexmap(map: Partial<ReturnType<typeof emptyHexMap>> = {}): EntityBody {
  return { type: 'hexmap', content: emptyContent(), ...emptyHexMap(), ...map };
}

describe('harvestEdges (#179, ADR-0046)', () => {
  it('reads a content entityLink as an edge to that Entity, carrying its Link Descriptor', () => {
    const body = note({ entityId: 'mira', label: 'Mira', descriptor: 'spouse' });

    expect(harvestEdges(body)).toEqual([
      { targetKind: 'entity', targetId: 'mira', descriptor: 'spouse' },
    ]);
  });

  /**
   * A Hex, a Feature, and a Region each carry their own Entity Link (a Label cannot).
   * A map placement expresses no relationship, so it never carries a Link Descriptor.
   */
  it('reads a hex, a feature, and a region link as descriptor-less edges', () => {
    const body = hexmap({
      hexes: {
        '0,0': { terrain: 'grass', entityId: 'harbour' },
        '1,0': { terrain: 'grass', feature: { ref: 'settlement', entityId: 'riverbend' } },
      },
      regions: [
        { id: 'r1', name: 'Avalon', color: '#aabbcc', hexes: {}, entityId: 'kingdom-of-avalon' },
      ],
    });

    expect(harvestEdges(body)).toEqual(
      expect.arrayContaining([
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        { targetKind: 'entity', targetId: 'kingdom-of-avalon', descriptor: null },
      ]),
    );
    expect(harvestEdges(body)).toHaveLength(3);
  });

  /**
   * Asset edges are groundwork for orphan detection / GC (ADR-0046) — harvested in the same
   * content walk, surfaced nowhere yet. An `image` pointing outside the Instance references no
   * Asset, so it is no edge.
   */
  it('reads an image at an Asset URL as an asset edge, and an external image as none', () => {
    const hash = 'a'.repeat(64);
    const body: EntityBody = {
      type: 'note',
      content: tiptapContent({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: `/assets/world-1/${hash}.png` } },
          { type: 'image', attrs: { src: 'https://example.test/cat.png' } },
        ],
      }),
    };

    expect(harvestEdges(body)).toEqual([
      { targetKind: 'asset', targetId: hash, descriptor: null },
    ]);
  });

  /**
   * A wikilink the import could not resolve keeps `entityId: null` (and, from that path, a null
   * descriptor with it). It names no target, so it is no edge — and since the `::` vocabulary is
   * now a projection of the edge set, a descriptor stranded on such a link joins no vocabulary
   * either. A descriptor characterises a relationship *to* something; with no target there is no
   * relationship to characterise.
   */
  it('ignores an entityLink that names no target, descriptor or not', () => {
    expect(harvestEdges(note({ entityId: null, label: 'Ghost', descriptor: 'rival' }))).toEqual([]);
    expect(harvestEdges(note({ label: 'Ghost' }))).toEqual([]);
  });

  it('finds links nested deep in the Content tree', () => {
    const body: EntityBody = {
      type: 'note',
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
                    content: [{ type: 'entityLink', attrs: { entityId: 'e1', descriptor: 'liege' } }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    };

    expect(harvestEdges(body)).toEqual([
      { targetKind: 'entity', targetId: 'e1', descriptor: 'liege' },
    ]);
  });

  /**
   * A Content snapshot is only walkable under a format this build knows — the same guard
   * `extractText` applies. The map payload is format-independent, so a Hex Map's placements
   * survive a Content format this build cannot read.
   */
  it('reads no Content edges under an unknown format tag, but still reads the map', () => {
    const alien = { format: 'prosemirror-v9', snapshot: { type: 'entityLink', attrs: { entityId: 'e1' } } };
    const body = {
      type: 'hexmap',
      content: alien,
      ...emptyHexMap(),
      hexes: { '0,0': { terrain: 'grass', entityId: 'harbour' } },
    } as unknown as EntityBody;

    expect(harvestEdges(body)).toEqual([
      { targetKind: 'entity', targetId: 'harbour', descriptor: null },
    ]);
  });

  /**
   * The grain is `(targetKind, targetId, descriptor)`. Nothing records *where* a link was
   * expressed (ADR-0046 rejects a `sourceKind` column), so a prose mention and a map
   * placement of the same target are the same edge — while two descriptors to that target
   * are two.
   */
  describe('the grain is (target, descriptor)', () => {
    it('collapses a descriptor-less content link and a map placement of the same target', () => {
      const body: EntityBody = {
        type: 'hexmap',
        content: prose({ entityId: 'riverbend', label: 'Riverbend' }),
        ...emptyHexMap(),
        hexes: { '0,0': { terrain: 'grass', entityId: 'riverbend' } },
      };

      expect(harvestEdges(body)).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
      ]);
    });

    it('keeps two descriptors to the same target as two edges', () => {
      const body = note(
        { entityId: 'mira', descriptor: 'spouse' },
        { entityId: 'mira', descriptor: 'rival' },
      );

      expect(harvestEdges(body)).toEqual([
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

      expect(harvestEdges(body)).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Spouse' },
        { targetKind: 'entity', targetId: 'mira', descriptor: null },
      ]);
    });

    /** Surrounding whitespace is never part of a descriptor, whatever its case. */
    it('trims the authored descriptor', () => {
      expect(harvestEdges(note({ entityId: 'mira', descriptor: '  Capital Of  ' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Capital Of' },
      ]);
    });
  });
});
