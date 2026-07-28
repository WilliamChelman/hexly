import { describe, expect, it } from 'vitest';
import { DESIGN_TOKENS, PublicDesignToken, designTokenInitial } from '@hexly/web-styles';
import {
  DEFAULT_PALETTE_PRESETS,
  FONT_PAIRINGS,
  FONT_PAIRING_IDS,
  OVERRIDABLE_TOKENS,
  PALETTE_PRESETS,
  PALETTE_PRESET_IDS,
  PALETTE_TOKENS,
  WORLD_THEME_VERSION,
  WorldTheme,
  WorldThemePalette,
  worldThemeSchema,
} from '@hexly/domain';
import { WorldThemeLayer } from '@hexly/web-core';
import {
  COLOR_SCHEMES,
  OVERRIDE_GROUPS,
  FONT_PAIRING_CHOICES,
  PALETTE_CONTROLS,
  PALETTE_PRESET_CHOICES,
  RADIUS_PRESETS,
  ThemeDraft,
  controlValue,
  defaultPalettes,
  draftFrom,
  draftToTheme,
  hexlyPalette,
  overrideSeed,
  overrideValue,
  palettePresetOf,
  radiusPresetOf,
  sameDraft,
  withControlValue,
  withOverride,
  withPalettePreset,
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
  return { version: WORLD_THEME_VERSION, light: palette(), dark: palette({ polarity: -1 }), ...over } as WorldTheme;
}

const draft = (over: Partial<ThemeDraft> = {}): ThemeDraft => ({
  light: palette(),
  dark: palette({ polarity: -1 }),
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

/**
 * The non-colour half an Owner authors (#375). Both are *sets*, picked whole: a radius ladder is one
 * decision in five values, and a pairing one in four.
 */
describe('the corner-radius sets an Owner picks between', () => {
  /** The manifest's own answer to what a radius set is made of (ADR-0075) — the schema's key set too. */
  const RADIUS_TOKENS = DESIGN_TOKENS.filter((decl) => decl.public && decl.type === 'length').map((decl) => decl.name);

  it('offers the Hexly default as an absence, so a World that picks it stores no set at all', () => {
    expect(RADIUS_PRESETS.find((preset) => preset.id === 'default')?.radii).toBeUndefined();
  });

  it('writes every radius the manifest declares, so no set leaves half a ladder behind', () => {
    for (const preset of RADIUS_PRESETS.filter((preset) => preset.radii)) {
      expect([preset.id, Object.keys(preset.radii ?? {}).sort()]).toEqual([preset.id, [...RADIUS_TOKENS].sort()]);
    }
  });

  it('authors only values the write choke point accepts — no percentage, no font-relative length', () => {
    // `--radius-*` are `@property`-registered, so an `em` computes at the element that declares them
    // and would silently mean twice the *root* size (ADR-0075). The schema refuses one; so must a set.
    for (const preset of RADIUS_PRESETS) {
      const parsed = worldThemeSchema.safeParse({ ...theme(), radii: preset.radii });
      expect([preset.id, parsed.success]).toEqual([preset.id, true]);
    }
  });

  it('runs from sharp to soft, so the axis an Owner is offered is the one the set moves', () => {
    const md = (id: string) => RADIUS_PRESETS.find((preset) => preset.id === id)?.radii?.['--radius-md'];

    expect(md('sharp')).toBe('0px');
    expect(parseFloat(md('soft') ?? '')).toBeGreaterThan(parseFloat(designTokenInitial('--radius-md')));
  });

  it('names the set a stored Theme carries, and none for one authored outside the editor', () => {
    expect(radiusPresetOf(undefined)).toBe('default');
    expect(radiusPresetOf(RADIUS_PRESETS.find((preset) => preset.id === 'sharp')?.radii)).toBe('sharp');
    // The schema takes any set of the five (ADR-0076); this editor offers a ladder, so it says so.
    expect(radiusPresetOf({ '--radius-md': '4px' })).toBeUndefined();
  });
});

describe('the font pairings an Owner picks between', () => {
  it('offers exactly the curated set the domain declares — no second list of pairings (#375)', () => {
    expect(FONT_PAIRING_CHOICES.map((choice) => choice.id)).toEqual([...FONT_PAIRING_IDS]);
  });

  it('carries each pairing’s own stacks, so a specimen cannot show a face the pairing will not apply', () => {
    for (const choice of FONT_PAIRING_CHOICES) {
      expect(choice.tokens).toEqual(FONT_PAIRINGS[choice.id]);
    }
  });
});

/** Every Preset the domain's table names, in its own order — the offer this editor reads (ADR-0077). */
const every = PALETTE_PRESET_IDS.map((id) => PALETTE_PRESETS[id]);

/**
 * The ready-made Palettes an Owner starts from (#384). A Preset is a **starting point, not a binding**:
 * picking copies values in, no id enters stored data, and which Preset a Palette is gets derived by
 * comparison — `RADIUS_PRESETS`' own rule, for its own reason (ADR-0077).
 */
describe('the Palette Presets an Owner picks between', () => {
  it('offers each ColorScheme the Presets the domain’s table names for it, and every entry somewhere', () => {
    // Read off the table, so a Preset added there heads its column with no edit in the editor.
    for (const scheme of COLOR_SCHEMES) {
      expect(PALETTE_PRESET_CHOICES[scheme].map((preset) => preset.id)).toEqual(
        PALETTE_PRESET_IDS.filter((id) => PALETTE_PRESETS[id].scheme === scheme),
      );
    }
    expect(COLOR_SCHEMES.flatMap((scheme) => PALETTE_PRESET_CHOICES[scheme].map((p) => p.id)).sort()).toEqual(
      [...PALETTE_PRESET_IDS].sort(),
    );
  });

  it('carries exactly the fields the stored Palette carries, so one pick fills in all eleven', () => {
    for (const preset of every) {
      expect([preset.id, Object.keys(preset.values).sort()]).toEqual([preset.id, Object.keys(PALETTE_TOKENS).sort()]);
    }
  });

  it('authors only values the write choke point accepts — its anchors and its named literals alike', () => {
    for (const preset of every) {
      const parsed = worldThemeSchema.safeParse({
        ...theme(),
        [preset.scheme]: preset.values,
        overrides: { [preset.scheme]: preset.overrides ?? {} },
      });
      expect([preset.id, parsed.success]).toEqual([preset.id, true]);
    }
  });

  it('states its literals as tokens the editor offers, so what a Preset wrote can be cleared back', () => {
    const overridable = new Set<string>(OVERRIDABLE_TOKENS.map((decl) => decl.name));

    for (const preset of every) {
      for (const token of Object.keys(preset.overrides ?? {})) {
        expect([preset.id, token, overridable.has(token)]).toEqual([preset.id, token, true]);
      }
    }
  });
});

describe('applying a Palette Preset', () => {
  const solar = PALETTE_PRESETS.solar;
  const astral = PALETTE_PRESETS.astral;
  const glow = OVERRIDE_GROUPS.flatMap((group) => group.controls).find((c) => c.token === '--color-canvas-glow')!;

  it('replaces that ColorScheme’s Palette whole — one click for eleven values', () => {
    expect(withPalettePreset(draft(), solar).light).toEqual(solar.values);
  });

  it('leaves the other ColorScheme, the radius set and the font pairing untouched', () => {
    // Choosing a colour palette must not undo unrelated choices (ADR-0077).
    const before = draft({ radii: { '--radius-md': '2px' }, fontPairing: 'codex' });

    const next = withPalettePreset(before, astral);

    expect(next.light).toEqual(before.light);
    expect(next.radii).toEqual({ '--radius-md': '2px' });
    expect(next.fontPairing).toBe('codex');
  });

  it('merges its literals into that ColorScheme’s overrides rather than replacing the map', () => {
    const before = draft({
      overrides: { dark: { '--color-ink-muted': '#112233' }, light: { '--color-ink': '#010203' } },
    });

    const next = withPalettePreset(before, astral);

    expect(next.overrides?.dark).toEqual({ '--color-ink-muted': '#112233', ...astral.overrides });
    expect(next.overrides?.light).toEqual({ '--color-ink': '#010203' });
  });

  it('writes a literal as an override like any other, so it reads as overridden and clears to derived', () => {
    // The honest wrinkle (ADR-0077): a dark Preset states its own field glow, and it genuinely is an
    // override — which means the Owner can hand it back.
    const picked = withPalettePreset(draft(), astral);
    const cleared = withOverride(picked.overrides, 'dark', glow.token, null);

    expect(overrideValue(picked.overrides, 'dark', glow)).toBeDefined();
    expect(overrideValue(cleared, 'dark', glow)).toBeUndefined();
  });

  it('writes each Preset’s own literals, so no Preset inherits the default one’s field glow', () => {
    // The gap ADR-0077 built the overrides slot to close: the stylesheet keys off `[data-color-scheme]`
    // and cannot know which Preset is active, so a Preset that did not state its own would wear the
    // default's — indigo starlight over a warm-charcoal page.
    for (const preset of every) {
      const written = withPalettePreset(draft(), preset).overrides?.[preset.scheme] ?? {};

      for (const [token, value] of Object.entries(preset.overrides ?? {})) {
        expect([preset.id, token, written[token as PublicDesignToken]]).toEqual([preset.id, token, value]);
      }
    }
  });

  it('hands back a copy, so editing the draft cannot reach into the table every World starts from', () => {
    expect(withPalettePreset(draft(), solar).light).not.toBe(solar.values);
  });

  it('sends values and no name at all — no Preset id ever enters stored data', () => {
    const sent = draftToTheme(withPalettePreset(withPalettePreset(draft(), solar), astral));

    for (const id of PALETTE_PRESET_IDS) expect(JSON.stringify(sent)).not.toContain(id);
  });
});

describe('which Palette Preset the Palette on screen is', () => {
  it('names the Preset a Palette matches, for its own ColorScheme', () => {
    for (const preset of every) {
      expect([preset.id, palettePresetOf(preset.values, preset.scheme)]).toEqual([preset.id, preset.id]);
    }
  });

  it('answers nothing for a Palette offered under the other ColorScheme — the columns are picked apart', () => {
    expect(palettePresetOf(PALETTE_PRESETS.astral.values, 'light')).toBeUndefined();
  });

  it('answers through the choke point’s canonical form, so a saved Preset is still that Preset', () => {
    // The table authors hex and the server stores OKLCH (ADR-0076); a lookup comparing notations would
    // lose the mark on the first reload, which is the one moment it is most needed. Every Preset, not
    // one: the round trip is hex → OKLCH → gamut-clamped sRGB, and it has to be exact for each of them.
    for (const preset of every) {
      const canonical = worldThemeSchema.parse({ ...theme(), [preset.scheme]: preset.values });

      expect(canonical[preset.scheme].page).toMatch(/^oklch\(/);
      expect([preset.id, palettePresetOf(canonical[preset.scheme], preset.scheme)]).toEqual([preset.id, preset.id]);
    }
  });

  it('answers nothing once an anchor moves, so the mark never claims a Preset an Owner has left', () => {
    const ink = PALETTE_CONTROLS.find((control) => control.field === 'ink')!;

    expect(palettePresetOf(withControlValue(PALETTE_PRESETS.solar.values, ink, '#112233'), 'light')).toBeUndefined();
  });

  it('answers nothing once a knob moves either — a Preset is its eleven values, not its eight anchors', () => {
    const veil = PALETTE_CONTROLS.find((control) => control.field === 'veil')!;

    expect(palettePresetOf(withControlValue(PALETTE_PRESETS.solar.values, veil, '0.4'), 'light')).toBeUndefined();
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

    expect(seeded?.light.accent).toBe('oklch(0.5461 0.1103 72.83)');
    expect(seeded?.dark.polarity).toBe(-1);
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
      overrides: { light: { '--color-ink': 'oklch(0.2 0 0)' } },
    });

    const round = draftToTheme(draftFrom(stored)!);

    expect(round.radii).toEqual({ '--radius-md': '2px' });
    expect(round.fontPairing).toBe('codex');
    expect(round.overrides).toEqual({ light: { '--color-ink': 'oklch(0.2 0 0)' } });
  });

  it('names both ColorSchemes, because an Owner who authors one ships half a Theme (ADR-0006)', () => {
    expect([...COLOR_SCHEMES]).toEqual(['light', 'dark']);
  });
});

/**
 * The tier-2 opt-outs (#374). The slice is the schema's own key set, not a filter written twice, so
 * these tests are about what the editor *does* with it: how it is grouped, what a control shows, and
 * that clearing leaves an absent key rather than a literal.
 */
describe('the override controls the manifest declares', () => {
  const flat = OVERRIDE_GROUPS.flatMap((group) => group.controls);

  it('offers exactly the tokens the write choke point accepts as override keys', () => {
    // Sorted, because grouping re-orders: what must match is the *set*, and each token's declared type.
    expect(flat.map((control) => control.token).sort()).toEqual(OVERRIDABLE_TOKENS.map((decl) => decl.name).sort());
    for (const decl of OVERRIDABLE_TOKENS) {
      expect([decl.name, flat.find((control) => control.token === decl.name)?.type]).toEqual([decl.name, decl.type]);
    }
  });

  it('offers no private Palette anchor and no plugin’s own vocabulary (ADR-0075)', () => {
    const offered = new Set<string>(flat.map((control) => control.token));

    expect(offered.has('--palette-accent')).toBe(false);
    expect(offered.has('--color-terrain-grass')).toBe(false);
    // Nor the radii, which are scheme-independent and authored once (#375), nor the type scale.
    expect(offered.has('--radius-md')).toBe(false);
    expect(offered.has('--text-base')).toBe(false);
  });

  it('puts every token in exactly one group, so none is unreachable and none is offered twice', () => {
    expect(flat).toHaveLength(new Set(flat.map((control) => control.token)).size);
    expect(flat).toHaveLength(OVERRIDABLE_TOKENS.length);
  });

  it('groups by the role family an Owner arrives asking about, not by declaration order', () => {
    const groupOf = (token: string) =>
      OVERRIDE_GROUPS.find((group) => group.controls.some((control) => control.token === token))?.id;

    expect(groupOf('--color-surface-raised')).toBe('surfaces');
    expect(groupOf('--color-ink-muted')).toBe('ink');
    // A foreground *is* an ink, whatever fill it sits on.
    expect(groupOf('--color-on-accent-sheen')).toBe('ink');
    expect(groupOf('--color-line-faint')).toBe('lines');
    expect(groupOf('--color-accent-sheen-deep')).toBe('accent');
    expect(groupOf('--color-tone-8-soft')).toBe('tones');
    expect(groupOf('--color-danger-soft')).toBe('status');
    expect(groupOf('--color-canvas-glow')).toBe('canvas');
    expect(groupOf('--shadow-focus')).toBe('elevation');
  });

  it('claims every token it offers, so nothing falls through to the catch-all today', () => {
    expect(OVERRIDE_GROUPS.map((group) => group.id)).not.toContain('other');
  });

  it('seeds a new override at the value the row was showing, so opting out changes nothing on screen', () => {
    const inkMuted = flat.find((control) => control.token === '--color-ink-muted')!;

    // Verbatim, not through `colorTokenHex`: a translucent role would lose its alpha to the hex.
    expect(overrideSeed(inkMuted, 'oklch(0.4879 0.0554 82.6 / 0.4)')).toBe('oklch(0.4879 0.0554 82.6 / 0.4)');
  });

  it('falls back to the manifest where the resolved value is no colour the choke point would take', () => {
    const inkMuted = flat.find((control) => control.token === '--color-ink-muted')!;

    expect(overrideSeed(inkMuted, '')).toBe(designTokenInitial('--color-ink-muted'));
  });

  it('seeds a shadow from the declaration whatever resolved, being unregistered and never a value', () => {
    // `@property` has no syntax component for a shadow (ADR-0075), so the document answers with an
    // unsubstituted `oklch(from …)` expression rather than a value the choke point would take.
    const shadow = flat.find((control) => control.token === '--shadow-1')!;

    expect(overrideSeed(shadow, '0 1px 2px oklch(from #3c2c16 l c h / 0.12)')).toBe(designTokenInitial('--shadow-1'));
  });
});

describe('the value an override control shows and the value it writes back', () => {
  const inkMuted = OVERRIDE_GROUPS.flatMap((g) => g.controls).find((c) => c.token === '--color-ink-muted')!;
  const shadow1 = OVERRIDE_GROUPS.flatMap((g) => g.controls).find((c) => c.token === '--shadow-1')!;

  it('shows nothing for a token nobody overrode — that token is derived, not set to anything', () => {
    expect(overrideValue(undefined, 'light', inkMuted)).toBeUndefined();
    expect(overrideValue({ dark: { '--color-ink-muted': '#123456' } }, 'light', inkMuted)).toBeUndefined();
  });

  it('shows a colour override as the hex a native colour control speaks', () => {
    expect(overrideValue({ light: { '--color-ink-muted': 'oklch(0.4879 0.0554 82.6)' } }, 'light', inkMuted)).toMatch(
      /^#[0-9a-f]{6}$/,
    );
  });

  it('shows a shadow override verbatim — a text field speaks the value as authored', () => {
    const stored = '0 1px 2px rgba(0, 0, 0, 0.4)';

    expect(overrideValue({ light: { '--shadow-1': stored } }, 'light', shadow1)).toBe(stored);
  });

  it('writes one ColorScheme’s override without touching the other’s', () => {
    const next = withOverride({ dark: { '--color-ink': '#fff' } }, 'light', '--color-ink-muted', '#112233');

    expect(next).toEqual({ dark: { '--color-ink': '#fff' }, light: { '--color-ink-muted': '#112233' } });
  });
});

/**
 * Clearing is an *absence*, not a value. The applier takes back whatever a previous write set and this
 * one does not (ADR-0076), so a missing key is what returns a token to its derived value — writing the
 * derived value as a literal would freeze it against the next anchor move instead.
 */
describe('clearing an override', () => {
  it('removes the key rather than emptying it', () => {
    const next = withOverride(
      { light: { '--color-ink': '#111111', '--color-ink-muted': '#222222' } },
      'light',
      '--color-ink',
      null,
    );

    expect(next).toEqual({ light: { '--color-ink-muted': '#222222' } });
    expect(Object.keys(next?.light ?? {})).not.toContain('--color-ink');
  });

  it('drops a ColorScheme left with nothing, and the block itself when both are', () => {
    const one = withOverride({ light: { '--color-ink': '#111111' }, dark: {} }, 'light', '--color-ink', null);

    expect(one).toBeUndefined();
  });

  it('returns the draft to the one it started as, so setting then clearing is not an unsaved change', () => {
    const before = draft();
    const set = { ...before, overrides: withOverride(before.overrides, 'light', '--color-ink', '#111111') };
    const cleared = { ...set, overrides: withOverride(set.overrides, 'light', '--color-ink', null) };

    expect(sameDraft(before, set)).toBe(false);
    expect(sameDraft(before, cleared)).toBe(true);
  });

  it('leaves an overridden token at its override while every other one follows the anchors', () => {
    // The acceptance criterion that proves overrides sit *after* the derivation (ADR-0076): re-anchoring
    // rewrites tier 1, and the opt-out rides through untouched because it is not derived from it.
    const overrides = withOverride(undefined, 'light', '--color-ink-muted', '#112233');
    const accent = PALETTE_CONTROLS.find((control) => control.field === 'accent')!;
    const before: ThemeDraft = { ...draft(), overrides };

    const reanchored: ThemeDraft = { ...before, light: withControlValue(before.light, accent, '#6a2ab0') };

    expect(reanchored.light.accent).toBe('#6a2ab0');
    expect(reanchored.overrides).toEqual({ light: { '--color-ink-muted': '#112233' } });
  });
});

describe('whether a draft has unsaved changes', () => {
  it('reads a rebuilt Palette and the stored one as the same Theme, whatever order their keys came in', () => {
    const reversed = (of: WorldThemePalette) =>
      Object.fromEntries(Object.entries(of).reverse()) as unknown as WorldThemePalette;
    const rebuilt: ThemeDraft = { dark: reversed(palette({ polarity: -1 })), light: reversed(palette()) };

    expect(sameDraft(draftFrom(theme()), rebuilt)).toBe(true);
  });

  it('sees a single edited anchor', () => {
    const edited = { ...draft(), light: { ...palette(), accent: '#112233' } };

    expect(sameDraft(draftFrom(theme()), edited)).toBe(false);
  });

  it('tells a staged reset apart from the Theme it would clear', () => {
    expect(sameDraft(null, draftFrom(theme()))).toBe(false);
    expect(sameDraft(null, null)).toBe(true);
  });
});

/**
 * Hexly's own anchors, answered from the Preset table (ADR-0077) — so this environment, which loads no
 * stylesheet, tests the accessor itself rather than the manifest fallback an offscreen probe took here.
 */
describe('the Hexly default each ColorScheme opens at', () => {
  it('answers a full Palette for either ColorScheme', () => {
    for (const scheme of COLOR_SCHEMES) {
      expect(Object.keys(hexlyPalette(scheme)).sort()).toEqual(Object.keys(PALETTE_TOKENS).sort());
    }
  });

  it('answers each ColorScheme’s default Preset, which is what the stylesheet is generated from', () => {
    for (const scheme of COLOR_SCHEMES) {
      expect(hexlyPalette(scheme)).toEqual(PALETTE_PRESETS[DEFAULT_PALETTE_PRESETS[scheme]].values);
    }
  });

  it('hands back a copy, so editing a draft cannot reach into the table every World starts from', () => {
    expect(hexlyPalette('light')).not.toBe(PALETTE_PRESETS[DEFAULT_PALETTE_PRESETS['light']].values);
  });

  it('types the knobs as numbers, which is what a knob control reads back', () => {
    expect(typeof hexlyPalette('light').polarity).toBe('number');
    expect(typeof hexlyPalette('dark').veil).toBe('number');
  });
});

/**
 * What an unthemed World's controls open at (#371 × #372). The Instance default is a *starting point*
 * an Owner departs from, so the editor has to seed from the resolved chain — Instance layer where it
 * has a value, Hexly's own where it does not. The table cannot see the operator's layer at all, which
 * is why the two are composed here rather than read off one place.
 */
describe('the default an unthemed World opens at, under an Instance default', () => {
  const OPERATOR_ACCENT = 'oklch(0.6 0.2 300)';
  const OPERATOR_DARK_PAGE = 'oklch(0.15 0.03 300)';

  /** An operator branding two anchors and nothing else — the layer is partial by design. */
  const instance: WorldThemeLayer = {
    light: { accent: OPERATOR_ACCENT },
    dark: { page: OPERATOR_DARK_PAGE },
  };

  it('seeds the anchors the operator branded from the operator', () => {
    const defaults = defaultPalettes(instance);

    expect(defaults.light.accent).toBe(OPERATOR_ACCENT);
    expect(defaults.dark.page).toBe(OPERATOR_DARK_PAGE);
  });

  it('seeds every anchor the operator left alone from Hexly’s own, per ColorScheme', () => {
    const defaults = defaultPalettes(instance);
    const hexly = { light: hexlyPalette('light'), dark: hexlyPalette('dark') };

    expect(defaults.light.page).toBe(hexly.light.page);
    expect(defaults.light.ink).toBe(hexly.light.ink);
    // A layer that brands the light accent has said nothing about the dark one: the merge is per anchor,
    // per ColorScheme, not per Palette.
    expect(defaults.dark.accent).toBe(hexly.dark.accent);
    expect(defaults.dark.accent).not.toBe(OPERATOR_ACCENT);
    expect(defaults.light.page).not.toBe(OPERATOR_DARK_PAGE);
  });

  it('keeps the knobs numbers, whichever layer supplied them', () => {
    const defaults = defaultPalettes({ light: { veil: 0.4 } });

    expect(defaults.light.veil).toBe(0.4);
    expect(typeof defaults.dark.veil).toBe('number');
  });

  it('falls back to Hexly’s own with no Instance layer at all', () => {
    expect(defaultPalettes(null).light.accent).toBe(hexlyPalette('light').accent);
  });

  it('saves the operator’s branding untouched when an Owner moves one other anchor', () => {
    // The regression guard. A stored Theme carries both Palettes entire, so a first edit materialises
    // all eleven anchors — seeded from the stylesheet they would silently overwrite the operator's.
    const defaults = defaultPalettes(instance);
    const ink = PALETTE_CONTROLS.find((control) => control.field === 'ink')!;

    const sent = draftToTheme({ ...defaults, light: withControlValue(defaults.light, ink, '#112233') });

    expect(sent.light.ink).toBe('#112233');
    expect(sent.light.accent).toBe(OPERATOR_ACCENT);
    expect(sent.dark.page).toBe(OPERATOR_DARK_PAGE);
  });
});
