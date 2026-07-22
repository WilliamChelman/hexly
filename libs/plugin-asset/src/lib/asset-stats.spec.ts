import { assetKind, bucketHue, HUE_BUCKETS, orientationOf } from './asset-stats';

describe('bucketHue (the named-hue facet, ADR-0055/0065)', () => {
  it('buckets a saturated color into its hue-wheel wedge', () => {
    expect(bucketHue('#ff0000')).toBe('red');
    expect(bucketHue('#ff8000')).toBe('orange');
    expect(bucketHue('#ffff00')).toBe('yellow');
    expect(bucketHue('#00ff00')).toBe('green');
    expect(bucketHue('#00ffff')).toBe('cyan');
    expect(bucketHue('#0000ff')).toBe('blue');
    expect(bucketHue('#8000ff')).toBe('purple');
    expect(bucketHue('#ff00ff')).toBe('pink');
  });

  it('wraps the red wedge across the 360°/0° seam', () => {
    // A hue just below 360° (a magenta-leaning red) still reads as red, not pink.
    expect(bucketHue('#ff0033')).toBe('red');
  });

  it('buckets a low-saturation color by lightness into black / gray / white', () => {
    expect(bucketHue('#000000')).toBe('black');
    expect(bucketHue('#111111')).toBe('black');
    expect(bucketHue('#808080')).toBe('gray');
    expect(bucketHue('#ffffff')).toBe('white');
    // A barely-tinted near-gray is neutral, not its faint hue.
    expect(bucketHue('#7e8280')).toBe('gray');
  });

  it('every bucket it returns is a declared HueBucket', () => {
    const samples = ['#ff0000', '#00ff00', '#0000ff', '#000000', '#ffffff', '#808080', '#ff00ff'];
    for (const hex of samples) expect(HUE_BUCKETS).toContain(bucketHue(hex));
  });

  it('returns null for a string it cannot parse, so the harvest skips it', () => {
    expect(bucketHue('')).toBeNull();
    expect(bucketHue('red')).toBeNull();
    expect(bucketHue('#fff')).toBeNull();
    expect(bucketHue('#zzzzzz')).toBeNull();
  });
});

describe('assetKind (the kind facet from mime, ADR-0065)', () => {
  it('maps a mime to its Asset kind', () => {
    expect(assetKind('image/png')).toBe('image');
    expect(assetKind('image/webp')).toBe('image');
    expect(assetKind('application/pdf')).toBe('pdf');
    expect(assetKind('audio/mpeg')).toBe('audio');
    expect(assetKind('text/plain')).toBe('other');
    expect(assetKind('')).toBe('other');
  });
});

describe('orientationOf', () => {
  it('names the shape by comparing width and height', () => {
    expect(orientationOf(1200, 400)).toBe('landscape');
    expect(orientationOf(400, 1200)).toBe('portrait');
    expect(orientationOf(512, 512)).toBe('square');
  });
});
