/**
 * The World Theme editor's model (#371): what an Owner is editing, and which controls stand for it.
 *
 * The controls are read off the design-token manifest (ADR-0075) rather than listed here — the
 * manifest declares which tokens are tier 1 and what type each holds, and a second list of either
 * would be a second answer. What the manifest does not declare is a knob's *domain*, so that much is
 * beside it, held to the manifest's own tier-1 slice by this file's spec.
 */

import { DESIGN_TOKENS, DesignToken, TokenType, readDesignToken } from '@hexly/web-styles';
import { PALETTE_TOKENS, WORLD_THEME_VERSION, WorldTheme, WorldThemeInput, WorldThemePalette } from '@hexly/domain';
import { colorTokenHex } from '@hexly/domain';
import { ColorScheme } from '@hexly/web-core';

/**
 * The two halves an Owner authors in one sitting. A Theme and a reader's ColorScheme are orthogonal
 * (ADR-0006), so authoring only the scheme you happen to be sitting in ships half a Theme.
 */
export const COLOR_SCHEMES = ['solar', 'astral'] as const satisfies readonly ColorScheme[];

/** A numeric knob's domain — how far a control may take it, and at what grain. */
export interface KnobRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * What each knob's ramp was actually fitted at (#366). The manifest declares a knob's *type* and the
 * `@property` registration its syntax; neither says how far it may travel, and all three of these
 * misbehave outside their range rather than merely looking odd:
 *
 * - **polarity** is a scheme's mirror axis, not a scalar — every ramp's direction is its sign, and the
 *   spike fitted ±1. A two-member domain says so; intermediate values interpolate but are untested.
 * - **line-alpha** is multiplied by 1.85 for `line-strong`, which clips above ~0.54.
 * - **veil** is exponentiated for the shadow ladder, so 0 and 1 are both degenerate.
 */
const KNOB_RANGES: Readonly<Partial<Record<DesignToken, KnobRange>>> = {
  '--palette-polarity': { min: -1, max: 1, step: 2 },
  '--palette-line-alpha': { min: 0.01, max: 0.55, step: 0.005 },
  '--palette-veil': { min: 0.01, max: 0.99, step: 0.01 },
};

/**
 * One authorable value: the token it writes, the type that picks its control, and — for a knob — the
 * domain that bounds it. Deliberately not Palette-specific: the same shape describes a tier-2 override
 * (#374) and a radius (#375), so one control component serves all three.
 */
export interface TokenControl {
  readonly token: DesignToken;
  readonly type: TokenType;
  readonly range?: KnobRange;
}

/** A tier-1 control, which also names the stored Palette field it authors. */
export interface PaletteControl extends TokenControl {
  readonly field: keyof WorldThemePalette;
}

/** The stored field each tier-1 token is authored through — {@link PALETTE_TOKENS}, read backwards. */
const FIELD_OF = new Map<string, keyof WorldThemePalette>(
  Object.entries(PALETTE_TOKENS).map(([field, token]) => [token, field as keyof WorldThemePalette]),
);

/**
 * The Palette controls, in the manifest's own declaration order — eight anchors, then three knobs.
 * Declaring a new tier-1 token puts a control on the editor with no change here.
 */
export const PALETTE_CONTROLS: readonly PaletteControl[] = DESIGN_TOKENS.filter((decl) => decl.tier === 'palette').map(
  (decl) => ({
    token: decl.name,
    type: decl.type,
    // A field the stored schema does not carry cannot be authored; the spec holds the two sets equal.
    field: FIELD_OF.get(decl.name) as keyof WorldThemePalette,
    ...(KNOB_RANGES[decl.name] ? { range: KNOB_RANGES[decl.name] } : {}),
  }),
);

/**
 * A Theme as it is being edited. `null` is its own state and not an empty one: it means the World
 * carries no Theme, which is what reset returns to and what the controls then show the default for.
 *
 * Everything but the two Palettes rides through untouched — this editor authors tier 1, and #374 and
 * #375 author the rest, so a save from here must not drop what another surface stored.
 */
export interface ThemeDraft {
  readonly solar: WorldThemePalette;
  readonly astral: WorldThemePalette;
  readonly radii?: WorldTheme['radii'];
  readonly fontPairing?: WorldTheme['fontPairing'];
  readonly overrides?: WorldTheme['overrides'];
}

/** The draft a stored Theme opens as; `null`/`undefined` for a World that carries none. */
export function draftFrom(theme: WorldTheme | null | undefined): ThemeDraft | null {
  if (!theme) return null;
  // Field by field, not a spread minus `version`: the draft's shape is this editor's, and the version
  // it is re-stamped with on the way out is the contract this build knows rather than the one it read.
  const { solar, astral, radii, fontPairing, overrides } = theme;
  return { solar, astral, radii, fontPairing, overrides };
}

/** The draft as it is sent, stamped with the contract version it was authored against (ADR-0076). */
export function draftToTheme(draft: ThemeDraft): WorldThemeInput {
  return { version: WORLD_THEME_VERSION, ...draft };
}

/**
 * Whether two drafts are the same Theme — what "unsaved changes" is asked of. Key order is normalised,
 * because a draft's Palettes are rebuilt field by field while the saved one arrives as the server
 * serialised it, and an editor that called those different would offer to save nothing.
 */
export function sameDraft(a: ThemeDraft | null, b: ThemeDraft | null): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, raw) =>
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw as object).sort(([one], [two]) => one.localeCompare(two)))
      : raw,
  );
}

/** What `control` shows for `palette`: a hex for a colour, since that is what a colour control speaks. */
export function controlValue(palette: WorldThemePalette, control: PaletteControl): string {
  const value = palette[control.field];
  if (typeof value === 'number') return String(value);
  return colorTokenHex(value) ?? value;
}

/**
 * `palette` with `control`'s field set from what the control emitted. A colour is stored as authored —
 * canonicalising is the write choke point's job (ADR-0076), and doing it here would be a second answer
 * to it. A knob that does not read as a number leaves its field alone rather than storing `NaN`.
 */
export function withControlValue(palette: WorldThemePalette, control: PaletteControl, raw: string): WorldThemePalette {
  if (control.type !== 'number') return { ...palette, [control.field]: raw };
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return palette;
  return { ...palette, [control.field]: value };
}

/**
 * Hexly's own Palette for a ColorScheme, read off the document rather than restated here.
 *
 * The probe works because tier-1 declarations key off `[data-color-scheme]` on *any* element, not
 * `:root[…]` (ADR-0076): the rule declares the anchors on the probe, which beats the World Theme
 * inherited from the root — so this answers the default whichever Theme is currently painted, and for
 * the ColorScheme the reader is not in. Only jsdom takes the manifest fallback.
 */
export function hexlyPalette(scheme: ColorScheme): WorldThemePalette {
  const probe = document.createElement('div');
  probe.dataset['colorScheme'] = scheme;
  probe.style.display = 'none';
  document.body.append(probe);
  try {
    const style = getComputedStyle(probe);
    const palette: Record<string, string | number> = {};
    for (const control of PALETTE_CONTROLS) {
      const resolved = readDesignToken(style, control.token);
      palette[control.field] = control.type === 'number' ? Number(resolved) : resolved;
    }
    return palette as unknown as WorldThemePalette;
  } finally {
    probe.remove();
  }
}
