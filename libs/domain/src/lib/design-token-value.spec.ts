import { TokenType } from '@hexly/web-styles';
import { canonicalTokenValue } from './design-token-value';

/**
 * The choke point's round-trip property (ADR-0076): whatever stores re-parses to itself. The editor
 * re-sends a draft seeded from the stored Theme, so a value accepted once and refused on the way back
 * in takes every later save on that World down with it.
 */
describe('canonicalTokenValue idempotence', () => {
  /** A colour of every notation the canonicaliser accepts, to compose the shadow cases from. */
  const COLORS = [
    'red',
    '#1234567f',
    '#abc',
    'rgb(60 44 22)',
    'rgb(60, 44, 22, 0.42)',
    'rgba(60, 44, 22, 0.12)',
    'hsl(0 100% 50%)',
    'oklch(0.5185 0.1 78.5)',
    'oklch(0.5 0.1 40 / 0.5)',
    'oklab(0.5 0.1 -0.1)',
    'lab(50 120 -80)',
    'color(display-p3 1 0 0)',
    'transparent',
    // Rounding sits on a boundary in both: 360 is the hue 0 re-parses to, and 1 the alpha that
    // serialises as no alpha at all.
    'oklch(0.5 0.1 359.999)',
    'rgb(0 0 0 / 0.99999)',
  ];

  const CASES: readonly (readonly [TokenType, string])[] = [
    ...COLORS.map((value) => ['color', value] as const),
    ['number', '1'],
    ['number', '-0.5'],
    ['number', '+.75'],
    ['number', '1e5'],
    ['number', '0.00000001'],
    ['length', '0'],
    ['length', '8px'],
    ['length', '-0.5rem'],
    ['length', '1.23456vmin'],
    ['length', '999999.9999vmax'],
    ['shadow', '0 1px 2px'],
    ...COLORS.map((color) => ['shadow', `0 1px 2px ${color}`] as const),
    ...COLORS.map((color) => ['shadow', `inset 0 1px 2px 0 ${color}`] as const),
    ...COLORS.map((color) => ['shadow', `${color} 0 1px 2px`] as const),
    // The four longest layers the grammar admits: every offset present, `inset`, and a colour that
    // expands to full OKLCH — the shape that used to canonicalise past the gate its own input passed.
    ['shadow', Array(4).fill('inset 1.2345px 1.2345px 1.2345px 1.2345px #1234567f').join(', ')],
    ['shadow', Array(4).fill('1.2345px 1.2345px 1.2345px 1.2345px #1234567f').join(', ')],
    ['shadow', 'inset 0 1px 2px rgba(60, 44, 22, 0.12), 0 4px 12px oklch(0.2 0.03 60 / 0.2)'],
    // The widest value the type admits at all — every offset at the longest number and unit the length
    // grammar takes, and the longest chroma a colour can carry. What the length bound is fitted to.
    [
      'shadow',
      Array(4)
        .fill(
          'inset -999999.9999vmin -999999.9999vmin -999999.9999vmin -999999.9999vmin oklch(0.5 1e20 359.99 / 0.9999)',
        )
        .join(', '),
    ],
  ];

  it.each(CASES)('re-parses a canonical %s to itself: %s', (type, raw) => {
    const once = canonicalTokenValue(type, raw);

    expect([raw, once]).not.toEqual([raw, undefined]);
    expect([raw, canonicalTokenValue(type, once as string)]).toEqual([raw, once]);
  });

  it('refuses a pathological string outright, rather than trimming it into one that stores', () => {
    expect(canonicalTokenValue('shadow', Array(200).fill('0 1px 2px red').join(', '))).toBeUndefined();
    expect(canonicalTokenValue('color', `oklch(0.5 ${'9'.repeat(600)} 40)`)).toBeUndefined();
    expect(canonicalTokenValue('length', `${'9'.repeat(600)}px`)).toBeUndefined();
  });

  it('holds for every settable token type, so none is idempotent only by luck', () => {
    // A type with no case above would pass this suite vacuously.
    expect(new Set(CASES.map(([type]) => type))).toEqual(new Set(['color', 'number', 'length', 'shadow']));
  });
});
