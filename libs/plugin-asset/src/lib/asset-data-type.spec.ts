import { ASSET_DATA_TYPE, ASSET_FIELD, CORE_ASSET, emptyAssetValue } from './asset-data-type';
import { CORE_ASSET_TYPE } from './asset-type';
import { readAssetValue } from './asset-document';
import type { AssetValue } from './asset-value';

const HASH = 'a'.repeat(64);
const value: AssetValue = { hash: HASH, ext: '.png', mime: 'image/png', size: 11, stats: null };

describe('core.datatype.asset', () => {
  it('is a structured data-type carrying the datatype kind segment', () => {
    expect(CORE_ASSET).toBe('core.datatype.asset');
    expect(ASSET_DATA_TYPE.id).toBe(CORE_ASSET);
  });

  it('harvests the whole byte address for the dedup index (ADR-0065, #325)', () => {
    // The one data-type that owns bytes: its hash keys the (worldId, hash) → entity index, and the pinned
    // `ext` completes the address a read stats for presence (#325).
    expect(ASSET_DATA_TYPE.harvestAssetRef?.(value)).toEqual({ hash: HASH, ext: '.png' });
    // No edges or text — an Asset's prose is the Content Field's, not the ref's.
    expect(ASSET_DATA_TYPE.harvestEdges).toBeUndefined();
    expect(ASSET_DATA_TYPE.extractText).toBeUndefined();
  });

  it('declares the kind / orientation / hue facet dimensions (ADR-0055/0065)', () => {
    expect(ASSET_DATA_TYPE.facetDimensions?.map((d) => d.key)).toEqual(['kind', 'orientation', 'hue']);
  });

  it('harvests kind from the mime, and orientation + hue from the stats (ADR-0065)', () => {
    const withStats: AssetValue = {
      ...value,
      stats: { width: 1200, height: 400, orientation: 'landscape', dominantColor: '#c81818' },
    };
    expect(ASSET_DATA_TYPE.harvestFacets?.(withStats)).toEqual([
      { key: 'kind', value: 'image', num: null },
      { key: 'orientation', value: 'landscape', num: null },
      { key: 'hue', value: 'red', num: null },
    ]);
  });

  it('harvests kind alone when no extractor wrote stats (unparseable / non-image, ADR-0065)', () => {
    // A statless ref still faces the Browser rail by kind — a PDF, or an image sharp could not parse.
    expect(ASSET_DATA_TYPE.harvestFacets?.({ ...value, mime: 'application/pdf', stats: null })).toEqual([
      { key: 'kind', value: 'pdf', num: null },
    ]);
  });

  it('harvests nothing from a bare pre-mint placeholder ref (no bytes yet, ADR-0065)', () => {
    expect(ASSET_DATA_TYPE.harvestFacets?.(emptyAssetValue())).toEqual([]);
  });

  it('yields no byte address for an empty placeholder ref or an unparseable value (forward-only)', () => {
    expect(ASSET_DATA_TYPE.harvestAssetRef?.(emptyAssetValue())).toBeNull();
    expect(ASSET_DATA_TYPE.harvestAssetRef?.({ nonsense: true })).toBeNull();
  });

  it('projects to `omit` — the ref rides no Markdown file; the bytes are the export passthrough', () => {
    expect(ASSET_DATA_TYPE.vault?.slot).toBe('omit');
  });
});

describe('core.type.asset', () => {
  it('defaults the asset-ref and the canonical Content Fields (ADR-0065)', () => {
    expect(CORE_ASSET_TYPE.id).toBe('core.type.asset');
    expect(CORE_ASSET_TYPE.fieldRefs).toEqual([ASSET_FIELD.id, 'core.field.content']);
    expect(ASSET_FIELD.id).toBe('core.field.asset');
  });

  it('sets the generic hidden-from-default-listing capability so the Browser omits it by default (ADR-0065, #278)', () => {
    expect(CORE_ASSET_TYPE.hiddenFromDefaultListing).toBe(true);
  });
});

describe('reading an Asset Entity’s ref', () => {
  it('reads a filled asset-ref', () => {
    expect(readAssetValue({ 'core.field.asset': value })).toEqual(value);
  });

  it('reads a placeholder or absent ref as null (forward-only)', () => {
    expect(readAssetValue({ 'core.field.asset': emptyAssetValue() })).toBeNull();
    expect(readAssetValue({})).toBeNull();
  });
});
