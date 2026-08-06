import { assetRefFromUrl, assetUrl } from './asset';

/** A sha256 digest, lowercase base-16 — the content address an Asset is stored and served under. */
const HASH = 'a'.repeat(64);

describe('Asset serving URL (ADR-0034)', () => {
  it('round-trips a Container and a hash through the served URL', () => {
    expect(assetRefFromUrl(assetUrl('world-1', HASH, '.png'))).toEqual({ containerId: 'world-1', hash: HASH });
  });

  /** Identical bytes in two Containers share a hash but not an Asset, so the pair is what resolves (ADR-0080). */
  it('tells the same bytes served from two Containers apart', () => {
    const own = assetRefFromUrl(assetUrl('world-1', HASH, '.png'));
    const shelf = assetRefFromUrl(assetUrl('shelf-9', HASH, '.png'));

    expect(own?.hash).toBe(shelf?.hash);
    expect(own?.containerId).not.toBe(shelf?.containerId);
  });

  it('reads no Asset from a URL that names none', () => {
    expect(assetRefFromUrl('https://example.test/cat.png')).toBeNull();
    expect(assetRefFromUrl('data:image/png;base64,iVBOR')).toBeNull();
    // A vault-relative src the import has not yet rewritten.
    expect(assetRefFromUrl('portrait.png')).toBeNull();
    // The right shape, but not a content address.
    expect(assetRefFromUrl('/assets/world-1/not-a-hash.png')).toBeNull();
    // Path traversal never resolves to a hash, so it never mints an edge.
    expect(assetRefFromUrl(`/assets/world-1/../${HASH}.png`)).toBeNull();
  });
});
