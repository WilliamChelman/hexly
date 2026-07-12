import { assetHashFromUrl, assetUrl } from './asset';

/** A sha256 digest, lowercase base-16 — the content address an Asset is stored and served under. */
const HASH = 'a'.repeat(64);

describe('Asset serving URL (ADR-0034)', () => {
  /**
   * The builder and the parser are inverses, and that is the whole point of them sharing a home:
   * the Assets service mints the `src` an `image` node carries, and the edge harvest reads the
   * Asset `hash` back out of it (ADR-0046).
   */
  it('round-trips a hash through the served URL', () => {
    expect(assetHashFromUrl(assetUrl('world-1', HASH, '.png'))).toBe(HASH);
  });

  it('reads no hash from a URL that names no Asset', () => {
    expect(assetHashFromUrl('https://example.test/cat.png')).toBeNull();
    expect(assetHashFromUrl('data:image/png;base64,iVBOR')).toBeNull();
    // A vault-relative src the import has not yet rewritten.
    expect(assetHashFromUrl('portrait.png')).toBeNull();
    // The right shape, but not a content address.
    expect(assetHashFromUrl('/assets/world-1/not-a-hash.png')).toBeNull();
    // Path traversal never resolves to a hash, so it never mints an edge.
    expect(assetHashFromUrl(`/assets/world-1/../${HASH}.png`)).toBeNull();
  });
});
