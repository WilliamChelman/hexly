/**
 * The World Theme editor's model (#371): what an Owner is editing, and which controls stand for it.
 *
 * The controls are read off the design-token manifest (ADR-0075) rather than listed here — the
 * manifest declares which tokens are tier 1 and what type each holds, and a second list of either
 * would be a second answer. What the manifest does not declare is a knob's *domain*, so that much is
 * beside it, held to the manifest's own tier-1 slice by this file's spec.
 */

import {
  DESIGN_TOKENS,
  DesignToken,
  PublicDesignToken,
  TokenType,
  designTokenInitial,
  designTokenStyle,
  readDesignToken,
} from '@hexly/web-styles';
import {
  FONT_PAIRINGS,
  FONT_PAIRING_IDS,
  FontPairingId,
  OVERRIDABLE_TOKENS,
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

/** A tier-2 opt-out's control, which also names the token it writes (#374). */
export interface OverrideControl extends TokenControl {
  readonly token: PublicDesignToken;
  /** The token name without its `--`, for a test id. */
  readonly slug: string;
}

/** A named run of override controls — what one collapsible block of the editor holds. */
export interface OverrideGroup {
  readonly id: string;
  readonly controls: readonly OverrideControl[];
}

/**
 * How the overridable tokens are divided, in order; the first rule that claims a name wins.
 *
 * By **role family**, because that is the question an Owner arrives with — "the muted ink is too
 * pale", "the shadows are too heavy" — and the slice is ~50 tokens, which in declaration order is a
 * wall of colour wells rather than a list. Grouping by *type* would be no help: all but five are
 * colours.
 */
const OVERRIDE_GROUP_RULES: readonly { readonly id: string; readonly match: RegExp }[] = [
  { id: 'surfaces', match: /^--color-(bg|surface|overlay)/ },
  // A foreground is an ink, whatever fill it happens to sit on — `--color-on-*` belongs here.
  { id: 'ink', match: /^--color-(ink|on-)/ },
  { id: 'lines', match: /^--color-line/ },
  { id: 'accent', match: /^--color-accent/ },
  { id: 'tones', match: /^--color-tone-/ },
  { id: 'status', match: /^--color-(danger|success)/ },
  { id: 'canvas', match: /^--color-canvas/ },
  { id: 'elevation', match: /^--shadow-/ },
];

/** Where a token no rule claims lands, so a newly declared one is authorable without a change here. */
const OTHER_GROUP = 'other';

/**
 * The override controls, grouped. Read off `OVERRIDABLE_TOKENS` — the very list the write choke point
 * keys its schema on (ADR-0075/0076) — so the editor cannot offer a token the server would refuse, nor
 * withhold one it would accept.
 */
export const OVERRIDE_GROUPS: readonly OverrideGroup[] = (() => {
  const ids = [...OVERRIDE_GROUP_RULES.map((rule) => rule.id), OTHER_GROUP];
  const byId = new Map<string, OverrideControl[]>(ids.map((id) => [id, []]));
  for (const decl of OVERRIDABLE_TOKENS) {
    const id = OVERRIDE_GROUP_RULES.find((rule) => rule.match.test(decl.name))?.id ?? OTHER_GROUP;
    byId.get(id)?.push({ token: decl.name, type: decl.type, slug: decl.name.slice(2) });
  }
  return [...byId].map(([id, controls]) => ({ id, controls })).filter((group) => group.controls.length > 0);
})();

/** Both ColorSchemes' opt-outs, as a draft carries them. */
export type ThemeOverrides = WorldTheme['overrides'];

/**
 * What a new override starts at. For the ColorScheme the reader is `live` in, the value the document
 * resolved — so opting a token out changes nothing on screen, which is what makes the derivation a
 * starting point rather than a jump to somewhere the Owner never asked for.
 *
 * The other ColorScheme falls back to what the manifest declares, and cannot do better: the tier-2
 * roles are declared once at `:root`, so a `[data-color-scheme]` probe carries the other scheme's
 * anchors but still inherits the root's already-derived roles. So does a `shadow`, which is
 * `unregistered` (ADR-0075) and therefore resolves to an unsubstituted `oklch(from …)` expression — a
 * string the write choke point would rightly refuse. Only a registered colour answers with a value.
 *
 * Taken verbatim rather than through {@link colorTokenHex}: the control speaks hex, but a translucent
 * role would lose its alpha the moment it was opted out rather than when the Owner moved the well.
 */
export function overrideSeed(control: OverrideControl, live: boolean): string {
  const declared = designTokenInitial(control.token);
  if (!live || control.type !== 'color') return declared;
  const resolved = readDesignToken(designTokenStyle(), control.token);
  return colorTokenHex(resolved) === undefined ? declared : resolved;
}

/** What `control` shows for `scheme`, or `undefined` where nothing overrides it — that token is derived. */
export function overrideValue(
  overrides: ThemeOverrides,
  scheme: ColorScheme,
  control: OverrideControl,
): string | undefined {
  const stored = overrides?.[scheme]?.[control.token];
  if (stored === undefined) return undefined;
  // A colour control speaks hex, as in `controlValue`; every other type shows the value as authored.
  return control.type === 'color' ? (colorTokenHex(stored) ?? stored) : stored;
}

/**
 * `overrides` with one token set for one ColorScheme, or — for `raw` of `null` — cleared.
 *
 * Clearing **removes the key**. The applier takes back whatever a previous write set and this one does
 * not (ADR-0076), so an absent key is what returns a token to its derived value; writing the derived
 * value as a literal would freeze it against the next anchor move instead. A ColorScheme left with
 * nothing, and the block itself when both are, go the same way — so clearing the last override leaves
 * the draft byte-identical to the one before the first, and "unsaved changes" says so.
 */
export function withOverride(
  overrides: ThemeOverrides,
  scheme: ColorScheme,
  token: PublicDesignToken,
  raw: string | null,
): ThemeOverrides {
  const scoped: Partial<Record<PublicDesignToken, string>> = { ...overrides?.[scheme] };
  if (raw === null) delete scoped[token];
  else scoped[token] = raw;

  const next: NonNullable<ThemeOverrides> = { ...overrides, [scheme]: scoped };
  for (const one of COLOR_SCHEMES) {
    if (Object.keys(next[one] ?? {}).length === 0) delete next[one];
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** Which corner-radius set a World wears; `default` is the one it wears by carrying none. */
export type RadiusPresetId = 'sharp' | 'default' | 'soft';

/** One offered set: the id its copy is keyed on, and the five values it stores. */
export interface RadiusPreset {
  readonly id: RadiusPresetId;
  /** Absent for the Hexly default — a World wears that one by storing no set (ADR-0076). */
  readonly radii?: WorldTheme['radii'];
}

/**
 * The radius sets on offer, sharp to soft (spec §5.1). Sets rather than five free lengths, though the
 * schema takes any set of the five: the five are one ladder, and a free `em` is a value `--radius-*`
 * cannot carry at all (ADR-0075). Stored as their values and never as an id, so renaming one here is
 * no migration against stored Themes.
 */
export const RADIUS_PRESETS: readonly RadiusPreset[] = [
  {
    id: 'sharp',
    radii: {
      '--radius-sm': '0px',
      '--radius-md': '0px',
      '--radius-lg': '0px',
      '--radius-xl': '0px',
      // Squared too: a pill or an avatar left round in an otherwise drafted World reads as an oversight.
      '--radius-full': '0px',
    },
  },
  { id: 'default' },
  {
    id: 'soft',
    radii: {
      '--radius-sm': '6px',
      '--radius-md': '12px',
      '--radius-lg': '18px',
      '--radius-xl': '28px',
      // A pill is already as round as it goes; softening the ladder does not make it rounder.
      '--radius-full': '999px',
    },
  },
];

/** Which offered set `radii` is, or `undefined` for one authored outside this editor. */
export function radiusPresetOf(radii: WorldTheme['radii']): RadiusPresetId | undefined {
  // Both sides normalised to an object: an absent set and an empty one are the same World.
  const stored = stable(radii ?? {});
  return RADIUS_PRESETS.find((preset) => stable(preset.radii ?? {}) === stored)?.id;
}

/** One offered pairing: its id, and the four `--font-*` stacks picking it writes. */
export interface FontPairingChoice {
  readonly id: FontPairingId;
  readonly tokens: Readonly<Partial<Record<PublicDesignToken, string>>>;
}

/**
 * The curated pairings on offer (spec §5.4), read off the domain's own table rather than restated, so
 * a pairing added there is pickable with no edit here — its name and hint are copy, and are not.
 */
export const FONT_PAIRING_CHOICES: readonly FontPairingChoice[] = FONT_PAIRING_IDS.map((id) => ({
  id,
  tokens: FONT_PAIRINGS[id],
}));

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
