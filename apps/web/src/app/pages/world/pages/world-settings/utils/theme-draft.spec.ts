import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS } from '@hexly/web-styles';
import { PALETTE_TOKENS, WORLD_THEME_VERSION, WorldTheme, WorldThemePalette } from '@hexly/domain';
import { WorldThemeLayer } from '@hexly/web-core';
import {
  COLOR_SCHEMES,
  PALETTE_CONTROLS,
  ThemeDraft,
  controlValue,
  defaultPalettes,
  draftFrom,
  draftToTheme,
  hexlyPalette,
  sameDraft,
  withControlValue,
} from './theme-draft';

function palette(over: Partial<WorldThemePalette> = {}): WorldThemePalette {
  return {
    page: 'oklch(0.9145 0.0446 89.35)',
    ink: 'oklch(0.2661 0.0269 74.24)',
    inkQuiet: 'oklch(0.4879 0.0554 82.6)',
    accent: 'oklch(0.5461 0.1103 72.83)',
    danger: 'oklch(0.5077 0.1341 32.28)',
    success: 'oklch(0.4926 0.1015 133.87)',
    canvas: 'oklch(0.9046 0.0472 90.79)',
    soot: 'oklch(0.3016 0.0402 72.35)',
    polarity: 1,
    lineAlpha: 0.371,
    veil: 0.12,
    ...over,
  };
}

function theme(over: Partial<WorldTheme> = {}): WorldTheme {
  return { version: WORLD_THEME_VERSION, solar: palette(), astral: palette({ polarity: -1 }), ...over } as WorldTheme;
}

const draft = (over: Partial<ThemeDraft> = {}): ThemeDraft => ({
  solar: palette(),
  astral: palette({ polarity: -1 }),
  ...over,
});

/** The editor's controls come from the manifest, not from a list beside it (ADR-0075, #371). */
describe('the Palette controls the manifest declares', () => {
  it('carries one control per tier-1 token, each with the type the manifest gave it', () => {
    const tier1 = DESIGN_TOKENS.filter((decl) => decl.tier === 'palette');

    expect(PALETTE_CONTROLS.map((control) => control.token)).toEqual(tier1.map((decl) => decl.name));
    expect(PALETTE_CONTROLS.map((control) => control.type)).toEqual(tier1.map((decl) => decl.type));
  });

  it('names, for each control, the stored Palette field it authors', () => {
    const authored = PALETTE_CONTROLS.map((control) => control.field).sort();

    expect(authored).toEqual(Object.keys(PALETTE_TOKENS).sort());
  });

  it('bounds every numeric knob, so a knob cannot ship as an unbounded scalar (#366)', () => {
    for (const control of PALETTE_CONTROLS.filter((c) => c.type === 'number')) {
      expect([control.token, control.range !== undefined]).toEqual([control.token, true]);
    }
  });

  it('holds the polarity knob to the ±1 the ramps were fitted at, not a free scalar (#366)', () => {
    const polarity = PALETTE_CONTROLS.find((control) => control.field === 'polarity');

    expect(polarity?.range).toEqual({ min: -1, max: 1, step: 2 });
  });

  it('keeps the line-alpha and veil knobs strictly inside the ranges their ramps hold (#366)', () => {
    const lineAlpha = PALETTE_CONTROLS.find((control) => control.field === 'lineAlpha')?.range;
    const veil = PALETTE_CONTROLS.find((control) => control.field === 'veil')?.range;

    expect(lineAlpha?.min).toBeGreaterThan(0);
    expect(lineAlpha?.max).toBeLessThanOrEqual(0.55);
    expect(veil?.min).toBeGreaterThan(0);
    expect(veil?.max).toBeLessThan(1);
  });
});

describe('the value a control shows and the value it writes back', () => {
  it('shows a colour anchor as the hex a native colour control speaks', () => {
    const accent = PALETTE_CONTROLS.find((control) => control.field === 'accent')!;

    expect(controlValue(palette({ accent: '#9a6a16' }), accent)).toBe('#9a6a16');
    expect(controlValue(palette({ accent: 'oklch(0.5461 0.1103 72.83)' }), accent)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shows a knob as its own number', () => {
    const veil = PALETTE_CONTROLS.find((control) => control.field === 'veil')!;

    expect(controlValue(palette({ veil: 0.4 }), veil)).toBe('0.4');
  });

  it('writes a colour back as the notation the control produced — canonicalising is the server’s', () => {
    const page = PALETTE_CONTROLS.find((control) => control.field === 'page')!;

    expect(withControlValue(palette(), page, '#112233').page).toBe('#112233');
  });

  it('writes a knob back as a number, never the string the control emitted', () => {
    const veil = PALETTE_CONTROLS.find((control) => control.field === 'veil')!;

    expect(withControlValue(palette(), veil, '0.42').veil).toBe(0.42);
  });

  it('leaves a knob alone when the control emits something that is not a number', () => {
    const veil = PALETTE_CONTROLS.find((control) => control.field === 'veil')!;

    expect(withControlValue(palette({ veil: 0.12 }), veil, '').veil).toBe(0.12);
  });
});

describe('the draft an Owner edits', () => {
  it('reads a World with no Theme as no draft — the Hexly default, which reset returns to', () => {
    expect(draftFrom(null)).toBeNull();
  });

  it('seeds both halves from a stored Theme, so neither ColorScheme opens empty', () => {
    const seeded = draftFrom(theme());

    expect(seeded?.solar.accent).toBe('oklch(0.5461 0.1103 72.83)');
    expect(seeded?.astral.polarity).toBe(-1);
  });

  it('stamps the contract version it was authored against', () => {
    expect(draftToTheme(draft()).version).toBe(WORLD_THEME_VERSION);
  });

  it('carries a Theme’s radii, font pairing and overrides through untouched', () => {
    // This editor authors the Palette alone (#371); #374 and #375 author the rest. A save from here
    // must not silently drop what another surface stored.
    const stored = theme({
      radii: { '--radius-md': '2px' },
      fontPairing: 'codex',
      overrides: { solar: { '--color-ink': 'oklch(0.2 0 0)' } },
    });

    const round = draftToTheme(draftFrom(stored)!);

    expect(round.radii).toEqual({ '--radius-md': '2px' });
    expect(round.fontPairing).toBe('codex');
    expect(round.overrides).toEqual({ solar: { '--color-ink': 'oklch(0.2 0 0)' } });
  });

  it('names both ColorSchemes, because an Owner who authors one ships half a Theme (ADR-0006)', () => {
    expect([...COLOR_SCHEMES]).toEqual(['solar', 'astral']);
  });
});

describe('whether a draft has unsaved changes', () => {
  it('reads a rebuilt Palette and the stored one as the same Theme, whatever order their keys came in', () => {
    const reversed = (of: WorldThemePalette) =>
      Object.fromEntries(Object.entries(of).reverse()) as unknown as WorldThemePalette;
    const rebuilt: ThemeDraft = { astral: reversed(palette({ polarity: -1 })), solar: reversed(palette()) };

    expect(sameDraft(draftFrom(theme()), rebuilt)).toBe(true);
  });

  it('sees a single edited anchor', () => {
    const edited = { ...draft(), solar: { ...palette(), accent: '#112233' } };

    expect(sameDraft(draftFrom(theme()), edited)).toBe(false);
  });

  it('tells a staged reset apart from the Theme it would clear', () => {
    expect(sameDraft(null, draftFrom(theme()))).toBe(false);
    expect(sameDraft(null, null)).toBe(true);
  });
});

describe('the Hexly default each ColorScheme opens at', () => {
  it('answers a full Palette for either ColorScheme', () => {
    for (const scheme of COLOR_SCHEMES) {
      expect(Object.keys(hexlyPalette(scheme)).sort()).toEqual(Object.keys(PALETTE_TOKENS).sort());
    }
  });

  it('types the knobs as numbers, whatever notation the document resolved them to', () => {
    expect(typeof hexlyPalette('solar').polarity).toBe('number');
    expect(typeof hexlyPalette('astral').veil).toBe('number');
  });

  it('leaves nothing of its probe behind on the document', () => {
    const before = document.body.childElementCount;

    hexlyPalette('astral');

    expect(document.body.childElementCount).toBe(before);
  });
});

/**
 * What an unthemed World's controls open at (#371 × #372). The Instance default is a *starting point*
 * an Owner departs from, so the editor has to seed from the resolved chain — Instance layer where it
 * has a value, Hexly's own where it does not. The probe cannot see the operator's layer: it is written
 * inline on the root, and a `[data-color-scheme]` rule declaring the anchors beats inheritance.
 */
describe('the default an unthemed World opens at, under an Instance default', () => {
  const OPERATOR_ACCENT = 'oklch(0.6 0.2 300)';
  const OPERATOR_ASTRAL_PAGE = 'oklch(0.15 0.03 300)';

  /** An operator branding two anchors and nothing else — the layer is partial by design. */
  const instance: WorldThemeLayer = {
    solar: { accent: OPERATOR_ACCENT },
    astral: { page: OPERATOR_ASTRAL_PAGE },
  };

  it('seeds the anchors the operator branded from the operator', () => {
    const defaults = defaultPalettes(instance);

    expect(defaults.solar.accent).toBe(OPERATOR_ACCENT);
    expect(defaults.astral.page).toBe(OPERATOR_ASTRAL_PAGE);
  });

  it('seeds every anchor the operator left alone from Hexly’s own, per ColorScheme', () => {
    const defaults = defaultPalettes(instance);
    const hexly = { solar: hexlyPalette('solar'), astral: hexlyPalette('astral') };

    expect(defaults.solar.page).toBe(hexly.solar.page);
    expect(defaults.solar.ink).toBe(hexly.solar.ink);
    // A layer that brands Solar's accent has said nothing about Astral's: the merge is per anchor,
    // per ColorScheme, not per Palette.
    expect(defaults.astral.accent).toBe(hexly.astral.accent);
    expect(defaults.astral.accent).not.toBe(OPERATOR_ACCENT);
    expect(defaults.solar.page).not.toBe(OPERATOR_ASTRAL_PAGE);
  });

  it('keeps the knobs numbers, whichever layer supplied them', () => {
    const defaults = defaultPalettes({ solar: { veil: 0.4 } });

    expect(defaults.solar.veil).toBe(0.4);
    expect(typeof defaults.astral.veil).toBe('number');
  });

  it('falls back to Hexly’s own with no Instance layer at all', () => {
    expect(defaultPalettes(null).solar.accent).toBe(hexlyPalette('solar').accent);
  });

  it('saves the operator’s branding untouched when an Owner moves one other anchor', () => {
    // The regression guard. A stored Theme carries both Palettes entire, so a first edit materialises
    // all eleven anchors — seeded from the stylesheet they would silently overwrite the operator's.
    const defaults = defaultPalettes(instance);
    const ink = PALETTE_CONTROLS.find((control) => control.field === 'ink')!;

    const sent = draftToTheme({ ...defaults, solar: withControlValue(defaults.solar, ink, '#112233') });

    expect(sent.solar.ink).toBe('#112233');
    expect(sent.solar.accent).toBe(OPERATOR_ACCENT);
    expect(sent.astral.page).toBe(OPERATOR_ASTRAL_PAGE);
  });
});
