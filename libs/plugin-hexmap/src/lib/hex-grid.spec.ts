import { emptyHexMap, HexMap } from './hex-map';
import { CORE_HEX_GRID, HEX_GRID_DATA_TYPE, HEX_GRID_FIELD } from './hex-grid';
import { CORE_HEXMAP_TYPE } from './hexmap-type';

/** A grid: an empty plane plus the test's overrides. */
const grid = (overrides: Partial<HexMap> = {}): HexMap => ({ ...emptyHexMap(), ...overrides });

describe('the core.hex-grid Structured Field (ADR-0050)', () => {
  it('mints a blank plane — every coordinate Void, no regions, no labels', () => {
    expect(HEX_GRID_DATA_TYPE.empty()).toEqual({ hexes: {}, regions: [], labels: [] });
  });

  it('is what core.hexmap declares, at the `grid` key — the whole of what makes an Entity a Hex Map', () => {
    expect(CORE_HEXMAP_TYPE.fields).toEqual([HEX_GRID_FIELD]);
    expect(HEX_GRID_FIELD).toMatchObject({ key: 'grid', dataType: { kind: CORE_HEX_GRID }, facetable: false });
  });

  /**
   * A Hex, a Feature, and a Region each carry their own Entity Link (a Label cannot). A map placement
   * expresses no relationship, so it never carries a Link Descriptor. This harvester is the only place
   * that knows a link can hang off any of the three — the domain's edge index takes what it returns
   * without learning what a grid holds.
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
        { targetKind: 'entity', targetId: 'harbour', descriptor: null },
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
        { targetKind: 'entity', targetId: 'kingdom-of-avalon', descriptor: null },
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
});
