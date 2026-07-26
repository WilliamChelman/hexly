/**
 * The World Theme (ADR-0076): the Palette a World Owner authors, stored inline on the World.
 *
 * Its key sets and per-value validators are generated from the design-token manifest (ADR-0075), which
 * is what declares who is in the public contract and what type each token holds; a second list of
 * either would be a second answer. Values go through `design-token-value.ts` — that is the boundary,
 * this is its shape.
 */

import * as z from 'zod';
import { DESIGN_TOKENS, DesignTokenDecl, PublicDesignToken, designToken } from '@hexly/web-styles';
import { canonicalTokenValue, isSettableTokenType } from './design-token-value';

/**
 * The stored shape's version. Every public token is a compatibility commitment, so a Theme names the
 * contract it was authored against and a version this build does not know is refused rather than
 * partly applied (ADR-0076).
 */
export const WORLD_THEME_VERSION = 1;

/**
 * The curated font pairings (spec §5.4). One entry today; a pairing writes all four `--font-*` tokens,
 * which is why they are public yet not settable one by one.
 */
export const FONT_PAIRING_IDS = ['codex'] as const;

/**
 * Each stored Palette field and the tier-1 token it writes (spec §1): eight anchors carrying the
 * identity, three knobs the derivation reads. #366 declares these in the manifest, collapsing this
 * table into a `tier === 'palette'` filter; until then it is the mapping the applier reads.
 */
export const PALETTE_TOKENS = {
  page: '--palette-page',
  ink: '--palette-ink',
  inkQuiet: '--palette-ink-quiet',
  accent: '--palette-accent',
  danger: '--palette-danger',
  success: '--palette-success',
  canvas: '--palette-canvas',
  soot: '--palette-soot',
  polarity: '--palette-polarity',
  lineAlpha: '--palette-line-alpha',
  veil: '--palette-veil',
} as const satisfies Readonly<Record<string, `--palette-${string}`>>;

/** A value of the given token type, refused unless it re-serialises from its own parse (ADR-0076). */
function tokenValue(type: DesignTokenDecl['type']) {
  return z.string().transform((raw, ctx) => {
    const canonical = canonicalTokenValue(type, raw);
    if (canonical === undefined) {
      ctx.addIssue({ code: 'custom', message: `not a ${type} value` });
      return z.NEVER;
    }
    return canonical;
  });
}

/**
 * A zod enum over a slice of the manifest, typed as the public union both call sites draw from. The
 * cast is safe while every one of them filters on `public`, which is also what keeps the slice
 * non-empty — an empty enum throws at module load rather than silently admitting nothing.
 */
function tokenEnum(decls: readonly DesignTokenDecl[]) {
  return z.enum(decls.map((decl) => decl.name) as [PublicDesignToken, ...PublicDesignToken[]]);
}

const colorValue = tokenValue('color');
/** An opacity: outside 0–1 it is not one, so it is refused rather than clamped. */
const alphaKnob = z.number().min(0).max(1);

/**
 * One ColorScheme's Palette. A World Theme carries two, because a Theme and a reader's ColorScheme are
 * orthogonal — the Owner supplies identity, the reader still chooses Solar or Astral within it
 * (ADR-0006, ADR-0076).
 */
const paletteSchema = z.object({
  page: colorValue,
  ink: colorValue,
  inkQuiet: colorValue,
  accent: colorValue,
  danger: colorValue,
  success: colorValue,
  canvas: colorValue,
  soot: colorValue,
  /** The ramp-direction and paper-chroma-slope knob; the spike authored it as ±1 (spec §1). */
  polarity: z.number(),
  lineAlpha: alphaKnob,
  veil: alphaKnob,
});

/**
 * The radius set (spec §5.1): the manifest's public `<length>` tokens, which is exactly the
 * `--radius-*` family — the type scale and the layout rails are structure, not identity, and out of the
 * contract (ADR-0076). Scheme-independent, which is why they sit here rather than in the overrides.
 */
const RADIUS_TOKENS = DESIGN_TOKENS.filter((decl) => decl.public && decl.type === 'length');

const radiiSchema = z.partialRecord(tokenEnum(RADIUS_TOKENS), tokenValue('length'));

/**
 * The tokens an override may key: the public contract, less the tier-1 anchors (those are the
 * `solar`/`astral` sets), less the radii (scheme-independent, so `radii` owns them and there is one
 * place to set each token), and less the types no value may be authored for.
 */
const OVERRIDABLE_TOKENS = DESIGN_TOKENS.filter(
  (decl) => decl.public && decl.tier !== 'palette' && decl.type !== 'length' && isSettableTokenType(decl.type),
);

/**
 * A ColorScheme's tier-2 opt-outs. The value's type comes from the token it keys, so one record
 * validates a colour and a shadow each against its own declared type.
 */
const overridesSchema = z.partialRecord(tokenEnum(OVERRIDABLE_TOKENS), z.string()).transform((entries, ctx) => {
  const canonical: Partial<Record<PublicDesignToken, string>> = {};
  for (const [name, raw] of Object.entries(entries) as [PublicDesignToken, string][]) {
    // The enum above admits only declared names, so the lookup always answers.
    const type = designToken(name)?.type;
    const value = type && canonicalTokenValue(type, raw);
    if (!value) {
      ctx.addIssue({ code: 'custom', message: `not a ${type} value`, path: [name] });
      return z.NEVER;
    }
    canonical[name] = value;
  }
  return canonical;
});

/**
 * A World Theme as stored. Unknown keys are dropped rather than refused — an older client's extra
 * field must not cost an Owner their save — but an unknown `version` is refused, which is the whole
 * point of carrying one.
 */
export const worldThemeSchema = z.object({
  version: z.literal(WORLD_THEME_VERSION),
  solar: paletteSchema,
  astral: paletteSchema,
  radii: radiiSchema.optional(),
  fontPairing: z.enum(FONT_PAIRING_IDS).optional(),
  overrides: z.object({ solar: overridesSchema.optional(), astral: overridesSchema.optional() }).optional(),
});

/** A World Theme as stored and read back — every value canonical. */
export type WorldTheme = z.infer<typeof worldThemeSchema>;

/** A World Theme as sent: the authored notations, before the choke point re-serialises them. */
export type WorldThemeInput = z.input<typeof worldThemeSchema>;

/** One ColorScheme's stored Palette — the anchors and knobs {@link PALETTE_TOKENS} names. */
export type WorldThemePalette = WorldTheme['solar'];
