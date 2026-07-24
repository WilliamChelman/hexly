import { resolveEffectiveFields } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { emptyHexMap, HexMap } from './hex-map';
import { CORE_HEX_GRID, HEX_GRID_DATA_TYPE, HEX_GRID_FIELD } from './hex-grid';
import { CORE_HEXMAP_TYPE } from './hexmap-type';

/** A grid: an empty plane plus the test's overrides. */
const grid = (overrides: Partial<HexMap> = {}): HexMap => ({ ...emptyHexMap(), ...overrides });

describe('the core.datatype.hex-grid Structured Data Type (ADR-0050)', () => {
  it('mints a blank plane — every coordinate Void, no regions, no labels', () => {
    expect(HEX_GRID_DATA_TYPE.empty()).toEqual({ hexes: {}, regions: [], labels: [] });
  });

  it('references the grid Field beside the canonical prose Field by id (ADR-0051, ADR-0054)', () => {
    // The grid is what makes an Entity a Hex Map; the prose Field rides alongside so a map carries lore.
    // The type references both by id (`fieldRefs`, the sole declaration), which resolve to the prose and
    // grid Fields in that order over the effective set both sides ride.
    expect(CORE_HEXMAP_TYPE.fieldRefs).toEqual([CONTENT_FIELD.id, HEX_GRID_FIELD.id]);
    const byId = new Map([CONTENT_FIELD, HEX_GRID_FIELD].map((field) => [field.id, field]));
    const fields = resolveEffectiveFields({
      types: [CORE_HEXMAP_TYPE.id],
      doc: {},
      fieldResolver: (id) => byId.get(id),
      typeFieldRefs: () => CORE_HEXMAP_TYPE.fieldRefs,
    });
    expect(fields.map((field) => field.id)).toEqual([CONTENT_FIELD.id, HEX_GRID_FIELD.id]);
    expect(HEX_GRID_FIELD).toMatchObject({
      id: 'core.field.grid',
      dataType: { kind: CORE_HEX_GRID },
      facetable: false,
    });
  });

  /**
   * A Hex, a Feature, and a Region each carry their own Entity Link (a Label cannot). A map placement
   * expresses no relationship, so it never carries a Link Descriptor.
   */
  it('harvests a hex, a feature, and a region link as descriptor-less edges', () => {
    const edges = HEX_GRID_DATA_TYPE.harvestEdges?.(
      grid({
        hexes: {
          '0,0': { terrain: 'grass', entityId: 'harbour' },
          '1,0': { terrain: 'grass', feature: { ref: 'settlement', entityId: 'riverbend' } },
        },
        regions: [{ id: 'r1', name: 'Avalon', color: '#aabbcc', hexes: {}, entityId: 'kingdom-of-avalon' }],
        labels: [{ id: 'l1', text: 'The Whisperwood', position: { x: 0, y: 0 }, size: 12 }],
      }),
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        { targetKind: 'entity', targetId: 'harbour', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'kingdom-of-avalon', descriptor: null, decor: false },
      ]),
    );
    // A Label carries no link, so it contributes no edge — three placements, three edges.
    expect(edges).toHaveLength(3);
  });

  it('harvests nothing from an unlinked plane, or from a malformed value at rest', () => {
    expect(HEX_GRID_DATA_TYPE.harvestEdges?.(grid({ hexes: { '0,0': { terrain: 'grass' } } }))).toEqual([]);
    // Forward-only (ADR-0048): a document this build cannot parse yields no edges rather than throwing.
    expect(HEX_GRID_DATA_TYPE.harvestEdges?.('garbage')).toEqual([]);
  });

  /** The searchable text a grid carries (#205). */
  describe('extractText', () => {
    it('yields its Hex names, Region names, and Labels', () => {
      const text = HEX_GRID_DATA_TYPE.extractText?.(
        grid({
          hexes: {
            '0,0': { terrain: 'grass', name: 'Ashford' },
            '1,0': { terrain: 'ocean', name: 'Harbour' },
          },
          regions: [{ id: 'r1', name: 'The Kingdom of Avalon', color: '#aabbcc', hexes: {} }],
          labels: [{ id: 'l1', text: 'The Whisperwood', position: { x: 0, y: 0 }, size: 12 }],
        }),
      );

      expect(text).toBe('Ashford Harbour The Kingdom of Avalon The Whisperwood');
    });

    it('yields nothing for a painted but unnamed plane, and never a terrain or feature id', () => {
      expect(
        HEX_GRID_DATA_TYPE.extractText?.(
          grid({ hexes: { '0,0': { terrain: 'grass', feature: { ref: 'settlement' } } } }),
        ),
      ).toBe('');
      expect(HEX_GRID_DATA_TYPE.extractText?.(emptyHexMap())).toBe('');
    });

    it('yields nothing from a malformed value at rest, rather than throwing (forward-only)', () => {
      expect(HEX_GRID_DATA_TYPE.extractText?.('garbage')).toBe('');
    });
  });
});
