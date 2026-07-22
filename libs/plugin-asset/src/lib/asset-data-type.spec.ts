import { ASSET_DATA_TYPE, ASSET_FIELD, CORE_ASSET, emptyAssetValue } from './asset-data-type';
import { CORE_ASSET_TYPE } from './asset-type';
import { readAssetValue, assetSummaryOf } from './asset-document';
import type { AssetValue } from './asset-value';

const HASH = 'a'.repeat(64);
const value: AssetValue = { hash: HASH, ext: '.png', mime: 'image/png', size: 11, stats: null };

describe('core.datatype.asset', () => {
  it('is a structured data-type carrying the datatype kind segment', () => {
    expect(CORE_ASSET).toBe('core.datatype.asset');
    expect(ASSET_DATA_TYPE.id).toBe(CORE_ASSET);
  });

  it('harvests the content hash for the dedup index, and nothing else (ADR-0065)', () => {
    // The one data-type that owns bytes: its hash keys the (worldId, hash) → entity index.
    expect(ASSET_DATA_TYPE.harvestAssetHash?.(value)).toBe(HASH);
    // No edges, text, or facets yet — extraction lands in its own ticket.
    expect(ASSET_DATA_TYPE.harvestEdges).toBeUndefined();
    expect(ASSET_DATA_TYPE.extractText).toBeUndefined();
    expect(ASSET_DATA_TYPE.harvestFacets).toBeUndefined();
  });

  it('yields no hash for an empty placeholder ref or an unparseable value (forward-only)', () => {
    expect(ASSET_DATA_TYPE.harvestAssetHash?.(emptyAssetValue())).toBeNull();
    expect(ASSET_DATA_TYPE.harvestAssetHash?.({ nonsense: true })).toBeNull();
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
});

describe('reading an Asset Entity’s ref', () => {
  it('reads a filled asset-ref, and a picker summary derived from it', () => {
    const doc = { 'core.field.asset': value };
    expect(readAssetValue(doc)).toEqual(value);
    expect(assetSummaryOf('world-1', 'Portrait', value)).toEqual({
      url: `/assets/world-1/${HASH}.png`,
      originalFilename: 'Portrait.png',
      mime: 'image/png',
      size: 11,
    });
  });

  it('reads a placeholder or absent ref as null (forward-only)', () => {
    expect(readAssetValue({ 'core.field.asset': emptyAssetValue() })).toBeNull();
    expect(readAssetValue({})).toBeNull();
  });
});
