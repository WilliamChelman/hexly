import { describe, expect, it } from 'vitest';
import { DesignToken } from '../tokens/manifest';
import {
  BODY_CONTRAST_MIN,
  CHIP_GROUNDS,
  CONTRAST_TOKENS,
  ChipFills,
  MeasuredScheme,
  Rgb,
  TONE_CONFUSION_MAX,
  TONE_FILLS,
  contrastRatio,
  deltaE00,
  themeWarnings,
} from './contrast';
import * as contrastModule from './contrast';
import * as measureModule from './measure';
import { measureScheme, rasteriseColors } from './measure';

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** A scheme where every token is measured, so a fixture only names what the case is about. */
function measured(over: Partial<Record<DesignToken, Rgb>> = {}): MeasuredScheme {
  const base = Object.fromEntries(CONTRAST_TOKENS.map((token) => [token, WHITE]));
  // Grounds white and inks black by default: nothing warns until a case makes it.
  return {
    ...base,
    '--color-ink': BLACK,
    '--color-ink-muted': BLACK,
    '--color-accent': BLACK,
    '--color-danger': [200, 0, 0],
    '--color-success': [0, 120, 0],
    ...over,
  };
}

/** Composited chip fills, black by default — the tones are white in {@link measured}, so nothing warns. */
function fills(over: ChipFills = {}): ChipFills {
  const base = Object.fromEntries(
    TONE_FILLS.map(([tone]) => [tone, Object.fromEntries(CHIP_GROUNDS.map((ground) => [ground, BLACK]))]),
  );
  return { ...base, ...over };
}

/** The two together, so the existing cases keep naming only what they are about. */
function report(over: Partial<Record<DesignToken, Rgb>> = {}, chipFills: ChipFills = fills()) {
  return themeWarnings(measured(over), chipFills);
}

describe('the functions apps/web-e2e hands to page.evaluate', () => {
  // Serialised by `Function.prototype.toString` and re-parsed in the browser, so anything they close
  // over is a `ReferenceError` there and nowhere here. Extracting a shared helper out of one of them is
  // how that happens: it reads fine, every unit test passes, and only the e2e run fails.
  it.each([
    ['measureScheme', measureScheme],
    ['rasteriseColors', rasteriseColors],
  ])('%s references nothing but its arguments and the DOM', (own, fn) => {
    const source = fn.toString();
    // Every name either module exports, rather than a list to keep up to date.
    const siblings = [...Object.keys(measureModule), ...Object.keys(contrastModule)].filter((name) => name !== own);
    for (const name of siblings) {
      expect(source, `${name} would not exist inside page.evaluate`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe('contrastRatio', () => {
  it('spans 1:1 for a colour on itself to 21:1 for black on white', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it('is symmetric, so a pair has one ratio however it is ordered', () => {
    expect(contrastRatio([154, 106, 22], [241, 229, 199])).toBeCloseTo(
      contrastRatio([241, 229, 199], [154, 106, 22]),
      9,
    );
  });

  it('agrees with the WCAG reference value for the darkest grey that passes on white', () => {
    // #767676 is the canonical AA boundary grey — 4.54:1 on white, and 4.48:1 one step lighter.
    expect(contrastRatio([0x76, 0x76, 0x76], WHITE)).toBeCloseTo(4.54, 2);
    expect(contrastRatio([0x77, 0x77, 0x77], WHITE)).toBeLessThan(BODY_CONTRAST_MIN);
  });
});

describe('deltaE00', () => {
  it('is zero for a colour against itself', () => {
    expect(deltaE00([154, 106, 22], [154, 106, 22])).toBeCloseTo(0, 9);
  });

  it('agrees with the CIEDE2000 reference for a known pair', () => {
    // Sharma's test data, pair 1 (Lab 50,2.6772,-79.7751 vs 50,0,-82.7485) is ΔE00 2.0425; the
    // nearest sRGB colours that round-trip to it are the ones below, so this is a coarse check that
    // the implementation is CIEDE2000 and not CIE76 — which would read 4.0 here.
    expect(deltaE00([255, 0, 0], [254, 0, 0])).toBeLessThan(0.5);
    expect(deltaE00([255, 0, 0], [0, 0, 255])).toBeGreaterThan(50);
  });
});

describe('themeWarnings', () => {
  it('says nothing about a Palette whose every pair is legible', () => {
    expect(report()).toEqual([]);
  });

  it('warns on a body pair below 4.5:1, and carries the ratio it computed', () => {
    const warnings = report({ '--color-ink-muted': [0xaa, 0xaa, 0xaa] });

    expect(warnings).toEqual([
      { kind: 'contrast', ink: '--color-ink-muted', ground: '--color-surface', ratio: expect.any(Number) },
      { kind: 'contrast', ink: '--color-ink-muted', ground: '--color-bg', ratio: expect.any(Number) },
    ]);
    expect(warnings[0]).toMatchObject({ ratio: contrastRatio([0xaa, 0xaa, 0xaa], WHITE) });
  });

  it('checks both inks against both grounds, and the accent against the page alone', () => {
    // Not a cross product: the accent is not body ink, so it is checked where a link sits on the page
    // and nowhere else (ADR-0076). A sixth pair here would be a policy change, not a tightening.
    const warnings = report({ '--color-surface': BLACK, '--color-bg': BLACK });

    expect(
      warnings.filter((warning) => warning.kind === 'contrast').map((warning) => [warning.ink, warning.ground]),
    ).toEqual([
      ['--color-ink', '--color-surface'],
      ['--color-ink', '--color-bg'],
      ['--color-ink-muted', '--color-surface'],
      ['--color-ink-muted', '--color-bg'],
      ['--color-accent', '--color-bg'],
    ]);
  });

  it('names a mid-tone accent, where the foreground CSS chose for it is not readable on it', () => {
    // A crimson at the worst lightness there is, with the `--color-on-fill` the engine resolves for it.
    const accent: Rgb = [234, 0, 66];
    const onFill: Rgb = [253, 230, 236];
    const warnings = report({ '--color-accent': accent, '--color-on-fill': onFill });

    expect(warnings).toContainEqual({ kind: 'midToneAccent', ratio: contrastRatio(onFill, accent) });
    expect(contrastRatio(onFill, accent)).toBeLessThan(BODY_CONTRAST_MIN);
  });

  it('stays quiet where the automatic foreground reaches 4.5:1 on the accent', () => {
    const warnings = report({ '--color-accent': [0xf0, 0xd0, 0x60], '--color-on-fill': [26, 23, 15] });

    expect(warnings.filter((warning) => warning.kind === 'midToneAccent')).toEqual([]);
  });

  it('cannot be written against pure black and white, which is why it reads the resolved on-colour', () => {
    // The floor of `max(black, white)` over every sRGB colour is 4.58:1 — reached around #5d60ff — so
    // "both black and white fail 4.5:1" is a condition no accent can meet. The retinted on-colour the
    // engine actually paints bottoms out at 3.86:1, which is what leaves the check something to catch.
    const worst: Rgb = [93, 96, 255];

    expect(Math.max(contrastRatio(worst, BLACK), contrastRatio(worst, WHITE))).toBeGreaterThan(BODY_CONTRAST_MIN);
  });

  it('flags a category tone that has rotated into confusion with danger or success', () => {
    const warnings = report({ '--color-tone-3': [200, 0, 0], '--color-tone-5': [0, 120, 0] });

    expect(warnings).toContainEqual({
      kind: 'toneCollision',
      tone: '--color-tone-3',
      against: '--color-danger',
      distance: expect.any(Number),
    });
    expect(warnings).toContainEqual({
      kind: 'toneCollision',
      tone: '--color-tone-5',
      against: '--color-success',
      distance: expect.any(Number),
    });
  });

  it('reports the nearer status colour only, so one tone yields one warning', () => {
    // A tone equal to danger is also some distance from success; a chip reads as the nearer one.
    const collisions = report({ '--color-tone-1': [200, 0, 0] }).filter((warning) => warning.kind === 'toneCollision');

    expect(collisions).toHaveLength(1);
    expect(collisions[0].against).toBe('--color-danger');
    expect(collisions[0].distance).toBeLessThan(TONE_CONFUSION_MAX);
  });

  it('leaves the eight tones alone when the accent has kept them out of the exclusion arc', () => {
    // The tightest two pairs Hexly's own Palette ships, read off `design-tokens.table.json`: Astral
    // tone-8 against danger and Solar tone-1 against success. The threshold is calibrated on the
    // design's own revealed tolerance (spike-tone-rotation.md §2), so it must not condemn it.
    const astralToneEight: Rgb = [242, 151, 186];
    const astralDanger: Rgb = [232, 138, 111];
    const solarToneOne: Rgb = [0, 85, 80];
    const solarSuccess: Rgb = [74, 111, 47];

    expect(deltaE00(astralToneEight, astralDanger)).toBeGreaterThan(TONE_CONFUSION_MAX);
    expect(deltaE00(solarToneOne, solarSuccess)).toBeGreaterThan(TONE_CONFUSION_MAX);
  });

  it("warns when a chip's own text does not clear its own fill, naming the worse of the two grounds", () => {
    // A chip carries its category in its text (ADR-0075), so this pair failing is the category going
    // unread — and the fill is translucent, so which ground it sits over decides it.
    const warnings = report(
      { '--color-tone-2': [0x99, 0x99, 0x99] },
      fills({
        '--color-tone-2': {
          '--color-surface': WHITE,
          '--color-bg': [0xcc, 0xcc, 0xcc],
        },
      }),
    );

    expect(warnings).toContainEqual({
      kind: 'chipContrast',
      tone: '--color-tone-2',
      ground: '--color-bg',
      ratio: expect.any(Number),
    });
  });

  it('clears Hexly’s own tightest Solar chip, and by less on the page than on a panel', () => {
    // Solar tone-4 off `design-tokens.table.json`, composited at the fill's 14%: 5.52:1 over `surface`
    // and 4.86:1 over the page. Before the polarity term went on the tone rows the page read 4.19:1 —
    // this pair is why that term is there, and the page staying the tighter of the two is why the
    // check reports the worse ground rather than picking one.
    const toneFour: Rgb = [62, 82, 147];
    const overSurface: Rgb = [225, 222, 217];
    const overPage: Rgb = [216, 208, 192];

    expect(contrastRatio(toneFour, overPage)).toBeGreaterThan(BODY_CONTRAST_MIN);
    expect(contrastRatio(toneFour, overPage)).toBeLessThan(contrastRatio(toneFour, overSurface));

    const warnings = report(
      { '--color-tone-4': toneFour },
      fills({
        '--color-tone-4': {
          '--color-surface': overSurface,
          '--color-bg': overPage,
        },
      }),
    );
    expect(warnings.filter((warning) => warning.kind === 'chipContrast')).toEqual([]);
  });

  it('refuses to report on a tone nobody composited, rather than passing it silently', () => {
    const short = fills();
    delete (short as Record<string, unknown>)['--color-tone-6'];

    expect(() => themeWarnings(measured(), short)).toThrow(/--color-tone-6/);
  });

  it('refuses to report on a token nobody measured, rather than passing it silently', () => {
    const short = { ...measured() };
    delete (short as Record<string, Rgb>)['--color-tone-4'];

    expect(() => themeWarnings(short, fills())).toThrow(/--color-tone-4/);
  });
});
