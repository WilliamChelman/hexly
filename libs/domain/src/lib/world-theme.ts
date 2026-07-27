/**
 * The World Theme (ADR-0076): the Palette a World Owner authors, stored inline on the World.
 *
 * Its key sets and per-value validators are generated from the design-token manifest (ADR-0075), which
 * is what declares who is in the public contract and what type each token holds; a second list of
 * either would be a second answer. Values go through `design-token-value.ts` — that is the boundary,
 * this is its shape.
 */

import * as z from 'zod';
import { DESIGN_TOKENS, DesignToken, DesignTokenDecl, PublicDesignToken, designToken } from '@hexly/web-styles';
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

export type FontPairingId = (typeof FONT_PAIRING_IDS)[number];

/**
 * What each pairing writes. Keyed by {@link FONT_PAIRING_IDS}, so a new id cannot ship without its
 * stacks; `codex` reads off the manifest, so Hexly's own pairing cannot drift from the default it
 * restates. Adding a pairing is an entry here and nothing in the applier.
 */
export const FONT_PAIRINGS: Readonly<Record<FontPairingId, Readonly<Partial<Record<PublicDesignToken, string>>>>> = {
  codex: Object.fromEntries(
    DESIGN_TOKENS.filter((decl) => decl.type === 'font-pairing').map((decl) => [decl.name, decl.initial]),
  ),
};

const PALETTE_PREFIX = '--palette-';

/** A tier-1 anchor or knob, as the manifest spells it. */
export type PaletteToken = Extract<DesignToken, `${typeof PALETTE_PREFIX}${string}`>;

type Camel<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<Camel<Tail>>}` : S;

/** The stored field a tier-1 token is written under: its suffix, camel-cased. */
export type PaletteField = PaletteToken extends `${typeof PALETTE_PREFIX}${infer Suffix}` ? Camel<Suffix> : never;

/**
 * Each stored Palette field and the tier-1 token it writes (spec §1): eight anchors carrying the
 * identity, three knobs the derivation reads. Derived from the manifest's `tier === 'palette'` slice,
 * so a new anchor cannot ship with the mapping still eleven entries long (ADR-0075).
 */
export const PALETTE_TOKENS = Object.fromEntries(
  DESIGN_TOKENS.filter((decl) => decl.tier === 'palette').map((decl) => [
    decl.name.slice(PALETTE_PREFIX.length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    decl.name,
  ]),
) as Readonly<Record<PaletteField, PaletteToken>>;

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
 *
 * The `satisfies` is the fence: a field per tier-1 token and no others, checked by the compiler. The
 * shapes stay written out because the manifest types both alphas and polarity as `number`, and only
 * this file knows an alpha is bounded.
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
} satisfies Record<PaletteField, z.ZodType>);

/**
 * The radius set (spec §5.1): the manifest's public `<length>` tokens, which is exactly the
 * `--radius-*` family — the type scale and the layout rails are structure, not identity, and out of the
 * contract (ADR-0076). Scheme-independent, which is why they sit here rather than in the overrides.
 */
const RADIUS_TOKENS = DESIGN_TOKENS.filter((decl) => decl.public && decl.type === 'length');

const radiiSchema = z.partialRecord(tokenEnum(RADIUS_TOKENS), tokenValue('length'));

/**
 * The tokens an override may key: the **tier-2 roles** alone — not the tier-1 anchors (those are the
 * `solar`/`astral` sets) and not a plugin's tier-3 vocabulary — less the radii (scheme-independent, so
 * `radii` owns them and there is one place to set each token), and less the types no value may be
 * authored for.
 *
 * `tier === 'role'` rather than `tier !== 'palette'`: tier 3 is out because it is a plugin's own
 * concept and not the design system's (ADR-0075), which has to hold whether or not a plugin ever marks
 * one of its tokens public. Excluded by the `public` flag alone, it would be excluded by accident.
 *
 * Exported because the editor renders a control per entry (#374). The schema's key set *is* the
 * editor's control set, rather than the same filter written twice — which is what ADR-0075 means by
 * one manifest generating both, and what stops an Owner being offered a token the choke point refuses.
 */
export const OVERRIDABLE_TOKENS = DESIGN_TOKENS.filter(
  (decl) => decl.public && decl.tier === 'role' && decl.type !== 'length' && isSettableTokenType(decl.type),
  // Narrowed here rather than at each reader: the `public` filter one line up is what makes it true.
) as readonly (DesignTokenDecl & { readonly name: PublicDesignToken })[];

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

/** Both Themes' opt-out block, shared so the operator's and the Owner's cannot drift apart. */
const overridesByScheme = { solar: overridesSchema.optional(), astral: overridesSchema.optional() };

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
  overrides: z.object(overridesByScheme).optional(),
});

/** A World Theme as stored and read back — every value canonical. */
export type WorldTheme = z.infer<typeof worldThemeSchema>;

/** A World Theme as sent: the authored notations, before the choke point re-serialises them. */
export type WorldThemeInput = z.input<typeof worldThemeSchema>;

/** One ColorScheme's stored Palette — the anchors and knobs {@link PALETTE_TOKENS} names. */
export type WorldThemePalette = WorldTheme['solar'];

/** One ColorScheme's Palette as an operator authors it: the same fields, none of them required. */
const partialPaletteSchema = z.strictObject(paletteSchema.partial().shape);

/**
 * An Instance operator's default Theme (#372): the chain's first layer, sourced from `hexly.yml`
 * (ADR-0036) rather than from a World. Every field is optional, because branding a deployment is
 * rarely a whole Theme — an operator setting only their accent supplies two anchors and lets
 * everything else fall through to the stylesheet — but each value goes through the same
 * canonicaliser an Owner's does, since operator-supplied is still input.
 *
 * Strict where the rest of `hexly.yml` strips an unknown key (ADR-0052): a misspelled anchor that
 * silently vanished would be exactly the default-applied-half-way this feature must not do, and
 * `version` already carries the cross-build compatibility the strip rule was there to protect.
 */
export const instanceThemeSchema = z.strictObject({
  version: z.literal(WORLD_THEME_VERSION),
  solar: partialPaletteSchema.optional(),
  astral: partialPaletteSchema.optional(),
  radii: radiiSchema.optional(),
  fontPairing: z.enum(FONT_PAIRING_IDS).optional(),
  overrides: z.strictObject(overridesByScheme).optional(),
});

/** An Instance default as loaded — every value canonical, and a layer the applier can resolve. */
export type InstanceTheme = z.infer<typeof instanceThemeSchema>;
