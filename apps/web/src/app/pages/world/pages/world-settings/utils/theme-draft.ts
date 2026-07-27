/**
 * The World Theme editor's model (#371): what an Owner is editing, and which controls stand for it.
 *
 * The controls are read off the design-token manifest (ADR-0075) rather than listed here — the
 * manifest declares which tokens are tier 1 and what type each holds, and a second list of either
 * would be a second answer. What the manifest does not declare is a knob's *domain*, so that much is
 * beside it, held to the manifest's own tier-1 slice by this file's spec.
 */

import { DESIGN_TOKENS, DesignToken, TokenType, readDesignToken } from '@hexly/web-styles';
import {
  PALETTE_TOKENS,
  WORLD_THEME_VERSION,
  WorldTheme,
  WorldThemeInput,
  WorldThemePalette,
  colorTokenHex,
} from '@hexly/domain';
import { ColorScheme, ThemeDeclarations, WorldThemeLayer, resolveWorldTheme } from '@hexly/web-core';

/**
 * The two halves an Owner authors in one sitting — a World Theme and a reader's ColorScheme are
 * orthogonal (ADR-0006).
 */
export const COLOR_SCHEMES = ['solar', 'astral'] as const satisfies readonly ColorScheme[];

/** A numeric knob's domain — how far a control may take it, and at what grain. */
export interface KnobRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * What each knob's ramp was fitted at (#366) — the manifest declares a knob's type, never how far it
 * may travel. Polarity is a mirror axis rather than a scalar, so its domain has two members; line-alpha
 * is multiplied by 1.85 and clips above ~0.54; veil is exponentiated, so 0 and 1 are both degenerate.
 */
const KNOB_RANGES: Readonly<Partial<Record<DesignToken, KnobRange>>> = {
  '--palette-polarity': { min: -1, max: 1, step: 2 },
  '--palette-line-alpha': { min: 0.01, max: 0.55, step: 0.005 },
  '--palette-veil': { min: 0.01, max: 0.99, step: 0.01 },
};

/** One authorable value: the token it writes, the type that picks its control, and a knob's domain. */
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
 * A World Theme as it is being edited. `null` is its own state and not an empty one: the World carries
 * none, which is what reset stages. Everything but the two Palettes rides through untouched, so a save
 * from this editor cannot drop what a surface authoring the rest of the contract stored.
 */
export interface ThemeDraft {
  readonly solar: WorldThemePalette;
  readonly astral: WorldThemePalette;
  readonly radii?: WorldTheme['radii'];
  readonly fontPairing?: WorldTheme['fontPairing'];
  readonly overrides?: WorldTheme['overrides'];
}

/** The draft a stored World Theme opens as; `null`/`undefined` for a World that carries none. */
export function draftFrom(theme: WorldTheme | null | undefined): ThemeDraft | null {
  if (!theme) return null;
  // Field by field rather than a spread minus `version`: what goes back out is stamped with the
  // contract this build knows, not the one it read.
  const { solar, astral, radii, fontPairing, overrides } = theme;
  return { solar, astral, radii, fontPairing, overrides };
}

/** The draft as it is sent, stamped with the contract version it was authored against (ADR-0076). */
export function draftToTheme(draft: ThemeDraft): WorldThemeInput {
  return { version: WORLD_THEME_VERSION, ...draft };
}

/**
 * Whether two drafts are the same World Theme — what "unsaved changes" is asked of. Key order is
 * normalised, because a draft's Palettes are rebuilt field by field while the saved one arrives as the
 * server serialised it.
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
 * `palette` with `control`'s field set from what the control emitted. A colour is stored as authored:
 * canonicalising is the write choke point's (ADR-0076), and a second answer to it would drift from it.
 */
export function withControlValue(palette: WorldThemePalette, control: PaletteControl, raw: string): WorldThemePalette {
  if (control.type !== 'number') return { ...palette, [control.field]: raw };
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return palette;
  return { ...palette, [control.field]: value };
}

/**
 * Hexly's own Palette for a ColorScheme, read off the document rather than restated here. Tier-1
 * declarations key off `[data-color-scheme]` on *any* element (ADR-0076), so the rule declares the
 * anchors on the probe and beats the World Theme inherited from the root — the default answers
 * whichever Theme is painted, and for the ColorScheme the reader is not in. Only jsdom falls back.
 */
export function hexlyPalette(scheme: ColorScheme): WorldThemePalette {
  const probe = document.createElement('div');
  probe.dataset['colorScheme'] = scheme;
  probe.style.display = 'none';
  document.body.append(probe);
  try {
    const style = getComputedStyle(probe);
    return paletteOf((token) => readDesignToken(style, token));
  } finally {
    probe.remove();
  }
}

/**
 * What an unthemed World's controls open at: the resolution chain's first two layers, **Instance
 * default over Hexly's own, anchor by anchor** (ADR-0076).
 *
 * The probe cannot answer this and must not be made to. An operator's layer is applied inline on the
 * root, and the `[data-color-scheme]` rule that lets {@link hexlyPalette} see past a World Theme sees
 * past that too — so the layer is read from where it is held rather than from the document.
 *
 * Composed through `resolveWorldTheme`, not a merge of its own: the layer is partial by design, an
 * operator may brand one anchor of one ColorScheme, and a `??` at the Palette level would take the
 * other ten from whichever layer supplied the first. This matters because a stored Theme carries both
 * Palettes entire — an Owner who moves one anchor saves all eleven, so seeding the other ten from the
 * stylesheet would silently overwrite the operator's branding on anchors nobody touched.
 */
export function defaultPalettes(
  instance: WorldThemeLayer | null | undefined,
): Readonly<Record<ColorScheme, WorldThemePalette>> {
  const hexly: WorldThemeLayer = { solar: hexlyPalette('solar'), astral: hexlyPalette('astral') };
  const resolved = resolveWorldTheme([hexly, instance]);
  const readFrom = (declarations: ThemeDeclarations) => paletteOf((token) => declarations[token] ?? '');
  return { solar: readFrom(resolved.solar), astral: readFrom(resolved.astral) };
}

/** One Palette, read token by token through `value` and typed by what the manifest declared. */
function paletteOf(value: (token: DesignToken) => string): WorldThemePalette {
  const palette: Record<string, string | number> = {};
  for (const control of PALETTE_CONTROLS) {
    const raw = value(control.token);
    palette[control.field] = control.type === 'number' ? Number(raw) : raw;
  }
  return palette as unknown as WorldThemePalette;
}
