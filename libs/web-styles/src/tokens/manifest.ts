import { TokenDecl } from './design-token';

/**
 * The design-token manifest — the single source of the token contract (ADR-0075).
 *
 * Declaration only: the values stay in `index.css` and `tokens.css`, and `manifest.spec.ts` holds the
 * two to each other in both directions. Tiers follow meaning, not location, so the hexmap tokens are
 * already tier 3 while their CSS still sits in core — the owning-plugin move is a later ticket.
 *
 * `as const` because `DesignToken` is read off it; consumers take the widened `DESIGN_TOKENS`.
 */
const DECLARATIONS = [
  // ---- Fonts. The pairing is chosen from a curated set (spec §5.4); the token shape is what a
  //      pairing writes into, which is why these are `font-pairing` rather than a free value.
  {
    name: '--font-cartouche',
    tier: 'role',
    type: 'font-pairing',
    public: true,
    initial: "'Cinzel Decorative', 'Marcellus', Georgia, serif",
  },
  { name: '--font-display', tier: 'role', type: 'font-pairing', public: true, initial: "'Marcellus', Georgia, serif" },
  {
    name: '--font-body',
    tier: 'role',
    type: 'font-pairing',
    public: true,
    initial: "'Source Serif 4 Variable', Georgia, 'Times New Roman', serif",
  },
  {
    name: '--font-mono',
    tier: 'role',
    type: 'font-pairing',
    public: true,
    initial: "'JetBrains Mono Variable', 'SFMono-Regular', Menlo, monospace",
  },

  // ---- Type scale. Out of the contract (spec §6): a token, but not an Owner's to set.
  // The scale is authored in `rem` so it follows the reader's own text size — see `unregistered`.
  { name: '--text-2xs', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0.6875rem' },
  { name: '--text-xs', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0.75rem' },
  { name: '--text-sm', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0.8125rem' },
  { name: '--text-base', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0.9375rem' },
  { name: '--text-md', tier: 'role', type: 'length', public: false, unregistered: true, initial: '1.0625rem' },
  { name: '--text-lg', tier: 'role', type: 'length', public: false, unregistered: true, initial: '1.3125rem' },
  { name: '--text-xl', tier: 'role', type: 'length', public: false, unregistered: true, initial: '1.625rem' },
  { name: '--text-2xl', tier: 'role', type: 'length', public: false, unregistered: true, initial: '2.0625rem' },
  { name: '--text-3xl', tier: 'role', type: 'length', public: false, unregistered: true, initial: '2.5625rem' },
  { name: '--leading-tight', tier: 'role', type: 'number', public: false, initial: '1.15' },
  { name: '--leading-snug', tier: 'role', type: 'number', public: false, initial: '1.35' },
  { name: '--leading-normal', tier: 'role', type: 'number', public: false, initial: '1.6' },
  // Tracking is authored in `em` so it scales with the text it spaces — see `unregistered`.
  { name: '--tracking-tight', tier: 'role', type: 'length', public: false, unregistered: true, initial: '-0.01em' },
  { name: '--tracking-normal', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0' },
  { name: '--tracking-wide', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0.04em' },
  { name: '--tracking-wider', tier: 'role', type: 'length', public: false, unregistered: true, initial: '0.14em' },
  { name: '--font-weight-regular', tier: 'role', type: 'number', public: false, initial: '400' },
  { name: '--font-weight-medium', tier: 'role', type: 'number', public: false, initial: '500' },
  { name: '--font-weight-semibold', tier: 'role', type: 'number', public: false, initial: '600' },
  { name: '--font-weight-bold', tier: 'role', type: 'number', public: false, initial: '700' },

  // ---- Radii. Public: a World Theme carries its own radius set (spec §5.1).
  { name: '--radius-sm', tier: 'role', type: 'length', public: true, initial: '3px' },
  { name: '--radius-md', tier: 'role', type: 'length', public: true, initial: '6px' },
  { name: '--radius-lg', tier: 'role', type: 'length', public: true, initial: '10px' },
  { name: '--radius-xl', tier: 'role', type: 'length', public: true, initial: '16px' },
  { name: '--radius-full', tier: 'role', type: 'length', public: true, initial: '999px' },

  // ---- Tier 2 — the semantic roles the UI styles itself from. The public contract.
  { name: '--color-bg', tier: 'role', type: 'color', public: true, initial: '#f1e5c7' },
  { name: '--color-bg-deep', tier: 'role', type: 'color', public: true, initial: '#e7d8b2' },
  { name: '--color-surface', tier: 'role', type: 'color', public: true, initial: '#fbf6e7' },
  { name: '--color-surface-raised', tier: 'role', type: 'color', public: true, initial: '#fffaf0' },
  { name: '--color-surface-sunken', tier: 'role', type: 'color', public: true, initial: '#ece0c0' },
  { name: '--color-overlay', tier: 'role', type: 'color', public: true, initial: 'rgba(58, 44, 28, 0.42)' },

  { name: '--color-ink', tier: 'role', type: 'color', public: true, initial: '#2e2412' },
  { name: '--color-ink-strong', tier: 'role', type: 'color', public: true, initial: '#211a0b' },
  { name: '--color-ink-muted', tier: 'role', type: 'color', public: true, initial: '#6f5a36' },
  { name: '--color-ink-faint', tier: 'role', type: 'color', public: true, initial: '#9c8a5e' },

  { name: '--color-line', tier: 'role', type: 'color', public: true, initial: '#d6c39a' },
  { name: '--color-line-strong', tier: 'role', type: 'color', public: true, initial: '#b89a62' },
  { name: '--color-line-faint', tier: 'role', type: 'color', public: true, initial: 'rgba(120, 86, 30, 0.16)' },

  { name: '--color-accent', tier: 'role', type: 'color', public: true, initial: '#9a6a16' },
  { name: '--color-accent-strong', tier: 'role', type: 'color', public: true, initial: '#7e560f' },
  { name: '--color-accent-soft', tier: 'role', type: 'color', public: true, initial: 'rgba(154, 106, 22, 0.14)' },
  { name: '--color-accent-sheen-bright', tier: 'role', type: 'color', public: true, initial: '#efd078' },
  { name: '--color-accent-sheen-deep', tier: 'role', type: 'color', public: true, initial: '#b98323' },
  { name: '--color-on-fill', tier: 'role', type: 'color', public: true, initial: '#fbf5e6' },
  { name: '--color-on-accent-sheen', tier: 'role', type: 'color', public: true, initial: '#2a1f08' },
  { name: '--color-accent-glow', tier: 'role', type: 'color', public: true, initial: 'rgba(210, 150, 40, 0.5)' },

  // The categorical pair, pending the `--color-tone-*` rotation that replaces them.
  { name: '--color-sea', tier: 'role', type: 'color', public: true, initial: '#2f6f7a' },
  { name: '--color-sea-soft', tier: 'role', type: 'color', public: true, initial: 'rgba(47, 111, 122, 0.14)' },
  { name: '--color-astra', tier: 'role', type: 'color', public: true, initial: '#5a4aa6' },
  { name: '--color-astra-soft', tier: 'role', type: 'color', public: true, initial: 'rgba(90, 74, 166, 0.14)' },

  { name: '--color-danger', tier: 'role', type: 'color', public: true, initial: '#a4402e' },
  { name: '--color-danger-soft', tier: 'role', type: 'color', public: true, initial: 'rgba(164, 64, 46, 0.14)' },
  { name: '--color-success', tier: 'role', type: 'color', public: true, initial: '#4a6f2f' },
  { name: '--color-success-soft', tier: 'role', type: 'color', public: true, initial: 'rgba(74, 111, 47, 0.16)' },

  // An infinite pan/zoom field and a legibility halo are design-system concepts, so they stay tier 2
  // even though only plugins consume them (ADR-0075).
  { name: '--color-canvas-bg', tier: 'role', type: 'color', public: true, initial: '#efe2bf' },
  { name: '--color-canvas-mat', tier: 'role', type: 'color', public: true, initial: '#e5d4a9' },
  { name: '--color-canvas-glow', tier: 'role', type: 'color', public: true, initial: 'rgba(255, 240, 202, 0.55)' },
  { name: '--color-canvas-edge', tier: 'role', type: 'color', public: true, initial: 'rgba(120, 86, 30, 0.14)' },
  { name: '--color-ink-stroke', tier: 'role', type: 'color', public: true, initial: '#fbf6e7' },

  // ---- Tier 3 — the hexmap plugin's own vocabulary. Out of the public contract: a per-World terrain
  //      set is a change to `terrainIdSchema` and a separate feature (ADR-0075). Still registered —
  //      `map-renderer.ts` reads every one of these back and hands it to a 2D context. The styleguide's
  //      terrain swatches read them from core and move out with them, ahead of the tier-aware lint rule.
  {
    name: '--color-hex-line',
    tier: 'plugin',
    type: 'color',
    public: false,
    owner: 'hexmap',
    initial: 'rgba(120, 96, 56, 0.42)',
  },
  { name: '--color-feature-ink', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#5a3e16' },
  { name: '--color-label-ink', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#4a3a1e' },
  { name: '--color-name-ink', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#5a4a2c' },
  { name: '--color-terrain-grass', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#b7be7e' },
  { name: '--color-terrain-forest', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#6f9560' },
  { name: '--color-terrain-ocean', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#7eaab0' },
  {
    name: '--color-terrain-mountain',
    tier: 'plugin',
    type: 'color',
    public: false,
    owner: 'hexmap',
    initial: '#b9a489',
  },
  { name: '--color-terrain-desert', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#e0c98c' },
  { name: '--color-terrain-marsh', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#93a87f' },
  { name: '--color-terrain-sky', tier: 'plugin', type: 'color', public: false, owner: 'hexmap', initial: '#a9c4d4' },

  // ---- Motion. Out of the contract (spec §6): a reader accessibility concern, not an Owner's to set.
  { name: '--dur-instant', tier: 'role', type: 'time', public: false, initial: '80ms' },
  { name: '--dur-fast', tier: 'role', type: 'time', public: false, initial: '150ms' },
  { name: '--dur-base', tier: 'role', type: 'time', public: false, initial: '240ms' },
  { name: '--dur-slow', tier: 'role', type: 'time', public: false, initial: '420ms' },
  { name: '--ease-out', tier: 'role', type: 'easing', public: false, initial: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  { name: '--ease-in-out', tier: 'role', type: 'easing', public: false, initial: 'cubic-bezier(0.65, 0, 0.35, 1)' },
  { name: '--ease-spring', tier: 'role', type: 'easing', public: false, initial: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },

  // ---- Layout rails. Out of the contract (spec §6).
  { name: '--rail-header', tier: 'role', type: 'length', public: false, initial: '56px' },
  { name: '--rail-status', tier: 'role', type: 'length', public: false, initial: '30px' },
  { name: '--rail-inspector', tier: 'role', type: 'length', public: false, initial: '320px' },
  // `ch` is measured against the reading column's own font, not the root's — see `unregistered`.
  { name: '--container-reading', tier: 'role', type: 'length', public: false, unregistered: true, initial: '68ch' },

  // ---- Elevation (ADR-0021). Public — only shadow colour and alpha re-theme.
  { name: '--shadow-1', tier: 'role', type: 'shadow', public: true, initial: '0 1px 2px rgba(60, 44, 22, 0.12)' },
  { name: '--shadow-2', tier: 'role', type: 'shadow', public: true, initial: '0 4px 12px -2px rgba(60, 44, 22, 0.2)' },
  {
    name: '--shadow-3',
    tier: 'role',
    type: 'shadow',
    public: true,
    initial: '0 16px 36px -8px rgba(50, 36, 18, 0.32)',
  },
  {
    name: '--shadow-inset',
    tier: 'role',
    type: 'shadow',
    public: true,
    initial: 'inset 0 1px 2px rgba(60, 44, 22, 0.12)',
  },
  { name: '--shadow-focus', tier: 'role', type: 'shadow', public: true, initial: '0 0 0 3px rgba(154, 106, 22, 0.32)' },

  // ---- The accent sheen's gradients. Not public: the material is composed from its stops, which are,
  //      and a settable gradient is the one place a `url()` could reach the page (spec §5.1).
  {
    name: '--gradient-accent-sheen',
    tier: 'role',
    type: 'gradient',
    public: false,
    initial: 'linear-gradient(180deg, var(--color-accent-sheen-bright), var(--color-accent-sheen-deep))',
  },
  {
    name: '--gradient-accent-sheen-radial',
    tier: 'role',
    type: 'gradient',
    public: false,
    initial: 'radial-gradient(circle at 50% 35%, var(--color-accent-sheen-bright), var(--color-accent-sheen-deep))',
  },
] as const satisfies readonly TokenDecl[];

/**
 * Every declared token name. Typing a token-valued field as `DesignToken` is what catches the bare
 * strings `no-unknown-design-token` structurally cannot see — it matches only `var(--…)` — such as
 * `TypeDefinition.graphColorToken` and the terrain set's `fill` (ADR-0075).
 */
export type DesignToken = (typeof DECLARATIONS)[number]['name'];

/** The names a World Theme may carry — the union the stored-theme schema and the editor key off. */
export type PublicDesignToken = Extract<(typeof DECLARATIONS)[number], { public: true }>['name'];

/** A declaration as consumers read it: one uniform shape, with the name narrowed to the union. */
export type DesignTokenDecl = TokenDecl & { readonly name: DesignToken };

/** The contract, in declaration order. Filter it by `tier`, `type`, `public`, or `owner`. */
export const DESIGN_TOKENS: readonly DesignTokenDecl[] = DECLARATIONS;

const BY_NAME: ReadonlyMap<string, DesignTokenDecl> = new Map(DESIGN_TOKENS.map((decl) => [decl.name, decl]));

/** Narrow an arbitrary custom-property name to a declared token. */
export function isDesignToken(name: string): name is DesignToken {
  return BY_NAME.has(name);
}

/**
 * The declaration for a token name, or `undefined` if nothing declares it — never `undefined` once the
 * name is narrowed to {@link DesignToken}, which is read off the very declarations this indexes.
 */
export function designToken(name: DesignToken): DesignTokenDecl;
export function designToken(name: string): DesignTokenDecl | undefined;
export function designToken(name: string): DesignTokenDecl | undefined {
  return BY_NAME.get(name);
}
