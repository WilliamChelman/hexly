import { DESIGN_TOKENS } from '@hexly/web-styles';
import { canonicalTokenValue, colorTokenHex } from './design-token-value';
import {
  FONT_PAIRINGS,
  FONT_PAIRING_IDS,
  instanceThemeSchema,
  OVERRIDABLE_TOKENS,
  PALETTE_TOKENS,
  WORLD_THEME_VERSION,
  WorldThemeInput,
  worldThemeSchema,
} from './world-theme';

/** The World Theme write choke point (ADR-0076): as much about what cannot round-trip as what can. */
describe('worldThemeSchema', () => {
  /** A minimal well-formed Theme; each test bends one field of it. */
  function theme(overrides: Partial<WorldThemeInput> = {}): WorldThemeInput {
    const palette = {
      page: '#f1e5c7',
      ink: '#2e2412',
      inkQuiet: '#6f5a36',
      accent: '#9a6a16',
      danger: '#a4402e',
      success: '#4a6f2f',
      canvas: '#efe2bf',
      soot: '#3c2c16',
      polarity: 1,
      lineAlpha: 0.371,
      veil: 0.12,
    };
    return { version: WORLD_THEME_VERSION, light: palette, dark: { ...palette, polarity: -1 }, ...overrides };
  }

  /** The parsed Theme, or `undefined` when the choke point refused it. */
  function parse(input: unknown) {
    const result = worldThemeSchema.safeParse(input);
    return result.success ? result.data : undefined;
  }

  it('accepts a well-formed Theme and emits every anchor as a colour', () => {
    const parsed = parse(theme());

    expect(parsed?.light.accent).toMatch(/^oklch\(/);
    expect(parsed?.dark.soot).toMatch(/^oklch\(/);
    expect(parsed?.dark.polarity).toBe(-1);
  });

  it('refuses a `url()` anchor — the value abuse the boundary exists for (ADR-0076)', () => {
    expect(parse(theme({ light: { ...theme().light, accent: 'url(https://evil.example/p.png)' } }))).toBeUndefined();
  });

  it.each([
    ['a garbage string', 'not-a-colour'],
    ['a declaration smuggled into the value', 'red; background: url(//evil.example/p.png)'],
    ['a `var()` reference', 'var(--color-accent)'],
    ['relative colour syntax', 'oklch(from var(--color-accent) l c h)'],
    ['a keyword that is not a colour', 'inherit'],
    ['an empty string', ''],
    // The colour parser throws on these rather than answering; a refusal that escapes `safeParse`
    // would reach the caller as a 500, from any signed-in user and before the Owner check.
    ['a malformed function the parser throws on', 'f(1x)'],
    ['a dimension in a slot that takes none', 'rgb(0 0 0 / 50s)'],
  ])('refuses %s as an anchor', (_label, value) => {
    expect(parse(theme({ light: { ...theme().light, accent: value } }))).toBeUndefined();
  });

  it('refuses an anchor that is not a string at all', () => {
    expect(parse(theme({ light: { ...theme().light, accent: 0xff0000 as unknown as string } }))).toBeUndefined();
  });

  it('refuses an unknown `version` rather than applying the part it understands', () => {
    expect(parse({ ...theme(), version: 3 })).toBeUndefined();
    expect(parse({ ...theme(), version: undefined })).toBeUndefined();
  });

  it('refuses a version-1 payload outright rather than partly applying it (ADR-0077)', () => {
    // The `solar`/`astral` shape as it was stored before the boot migration. The version field exists
    // for exactly this: the refusal names the contract rather than a missing anchor set.
    const { light, dark, ...rest } = theme();
    expect(parse({ ...rest, version: 1, solar: light, astral: dark })).toBeUndefined();
    // And the halfway house a lenient schema would produce — the keys renamed, the version not.
    expect(parse({ ...theme(), version: 1 })).toBeUndefined();
  });

  it('canonicalises to one form, so the notation an Owner sends stops mattering', () => {
    const red = ['red', '#ff0000', 'rgb(255 0 0)', 'rgb(255, 0, 0)', 'hsl(0 100% 50%)'].map(
      (notation) => parse(theme({ light: { ...theme().light, accent: notation } }))?.light.accent,
    );

    expect(new Set(red).size).toBe(1);
    expect(red[0]).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
  });

  it('keeps alpha, because the translucent roles are half the contract', () => {
    expect(parse(theme({ light: { ...theme().light, soot: 'rgba(60, 44, 22, 0.42)' } }))?.light.soot).toMatch(
      / \/ 0\.42\)$/,
    );
  });

  it('refuses a knob outside the range its role has', () => {
    expect(parse(theme({ light: { ...theme().light, veil: 1.4 } }))).toBeUndefined();
    expect(parse(theme({ light: { ...theme().light, lineAlpha: -0.1 } }))).toBeUndefined();
    expect(parse(theme({ light: { ...theme().light, polarity: Number.NaN } }))).toBeUndefined();
  });

  it('holds polarity to the ±1 axis it is authored on, at the schema and not only at the control', () => {
    // The editor's slider is not the boundary — a `PATCH /worlds/:id` is. Off the axis, every derived
    // tone goes black for readers who did not choose the Theme and cannot opt out of it (ADR-0076).
    expect(parse(theme({ light: { ...theme().light, polarity: 500 } }))).toBeUndefined();
    expect(parse(theme({ light: { ...theme().light, polarity: -1.5 } }))).toBeUndefined();
    expect(parse(theme({ light: { ...theme().light, polarity: 0 } }))?.light.polarity).toBe(0);
  });

  describe('overrides', () => {
    const withOverride = (name: string, value: unknown) =>
      parse({ ...theme(), overrides: { light: { [name]: value } } });

    it('accepts a public role token and canonicalises its value', () => {
      expect(withOverride('--color-ink-muted', '#6f5a36')?.overrides?.light?.['--color-ink-muted']).toMatch(/^oklch\(/);
    });

    it.each([
      ['an undeclared token', '--color-nope', '#fff'],
      ['a token out of the contract', '--text-base', '2rem'],
      ["another plugin's vocabulary", '--color-terrain-grass', '#fff'],
      // The tier boundary (ADR-0075): the anchors are authored as `light`/`dark`, and reaching one
      // through `overrides` would be a second way in, past the domains those fields hold them to.
      ['a private Palette anchor', '--palette-accent', '#fff'],
      ['a private Palette knob', '--palette-veil', '0.4'],
      [
        'a gradient — the one place a `url()` could reach the page',
        '--gradient-accent-sheen',
        'linear-gradient(red, blue)',
      ],
      ['a font stack, which only a pairing writes', '--font-body', 'Georgia, serif'],
      ['a radius, which `radii` owns because it is scheme-independent', '--radius-md', '8px'],
    ])('refuses %s as an override key', (_label, name, value) => {
      expect(withOverride(name, value)).toBeUndefined();
    });

    it('refuses a value of the wrong type for the token it keys', () => {
      expect(withOverride('--color-ink', '6px')).toBeUndefined();
      expect(withOverride('--shadow-2', '#ff0000')).toBeUndefined();
    });

    it('refuses a `url()` anywhere in a shadow, and canonicalises the colour of a real one', () => {
      expect(withOverride('--shadow-2', '0 4px 12px url(https://evil.example/p.png)')).toBeUndefined();
      expect(
        withOverride('--shadow-2', 'inset 0 1px 2px rgba(60, 44, 22, 0.12)')?.overrides?.light?.['--shadow-2'],
      ).toMatch(/^inset 0 1px 2px oklch\(/);
    });

    it('keys on the tier-2 roles alone, whatever a plugin marks public', () => {
      // Tier 3 is a plugin's own concept, not the design system's (ADR-0075). Every tier-3 token is
      // private today, so a `tier !== 'palette'` slice would exclude them by accident rather than say so.
      expect(OVERRIDABLE_TOKENS.every((decl) => decl.tier === 'role')).toBe(true);
    });

    it('accepts every token it publishes as overridable, at the value the manifest declares for it', () => {
      // The editor renders a control per entry and seeds a new override from `initial` (#374). A token
      // the schema advertises but refuses at its own declared value would be a control that cannot save.
      for (const decl of OVERRIDABLE_TOKENS) {
        expect([decl.name, withOverride(decl.name, decl.initial) !== undefined]).toEqual([decl.name, true]);
      }
    });

    it('keeps the two ColorSchemes apart', () => {
      const parsed = parse({ ...theme(), overrides: { dark: { '--color-ink': '#fff' } } });
      expect(parsed?.overrides?.dark?.['--color-ink']).toMatch(/^oklch\(/);
      expect(parsed?.overrides?.light).toBeUndefined();
    });
  });

  describe('radii and the font pairing', () => {
    it('keys the radius set on the `--radius-*` family alone', () => {
      // Sourced as the manifest's public `<length>` tokens; a public length outside the family would
      // widen `radii` silently, so it has to turn this red instead.
      expect(Object.keys(worldThemeSchema.shape.radii.unwrap().keyType.enum).sort()).toEqual([
        '--radius-full',
        '--radius-lg',
        '--radius-md',
        '--radius-sm',
        '--radius-xl',
      ]);
    });

    it('accepts a length for a radius token, and refuses anything that is not one', () => {
      expect(parse({ ...theme(), radii: { '--radius-md': '8px' } })?.radii?.['--radius-md']).toBe('8px');
      expect(parse({ ...theme(), radii: { '--radius-md': '50%' } })).toBeUndefined();
      expect(parse({ ...theme(), radii: { '--radius-md': 'calc(1px + 2px)' } })).toBeUndefined();
      expect(parse({ ...theme(), radii: { '--radius-md': '8' } })).toBeUndefined();
      // A radius token only: the type scale and the layout rails are out of the contract.
      expect(parse({ ...theme(), radii: { '--text-base': '1rem' } })).toBeUndefined();
    });

    it('accepts a curated pairing id and refuses an unlisted one', () => {
      expect(parse({ ...theme(), fontPairing: 'codex' })?.fontPairing).toBe('codex');
      expect(parse({ ...theme(), fontPairing: 'comic-sans' as never })).toBeUndefined();
    });

    it('draws the ids it accepts from the curated set alone, so a second pairing is no schema edit (#375)', () => {
      // Half of "adding a second pairing requires no schema or applier change": the schema restates no
      // id, and the table cannot carry one without its stacks. The applier's half is its own spec.
      expect(worldThemeSchema.shape.fontPairing.unwrap().options).toEqual([...FONT_PAIRING_IDS]);
      expect(Object.keys(FONT_PAIRINGS)).toEqual([...FONT_PAIRING_IDS]);
    });
  });

  it('maps every stored Palette field onto exactly the manifest’s tier-1 tokens', () => {
    // The applier reads this table, so both of its ends answer to their own source: the field names to
    // the stored schema, the token names to the manifest's Palette tier (ADR-0075).
    const stored = Object.keys(worldThemeSchema.shape.light.shape);
    expect(Object.keys(PALETTE_TOKENS).sort()).toEqual(stored.sort());

    const tier1 = DESIGN_TOKENS.filter((decl) => decl.tier === 'palette').map((decl) => decl.name);
    expect(Object.values(PALETTE_TOKENS).sort()).toEqual(tier1.sort());
  });

  it('accepts every settable public token’s own shipped value, and settles after one pass', () => {
    // The manifest declares what the contract holds and the choke point decides what may enter it, so
    // a token whose shipped value its own validator rejects would be unauthorable — and a canonical
    // value that canonicalises to something else would drift on every save.
    for (const decl of DESIGN_TOKENS.filter((d) => d.public && d.type !== 'font-pairing')) {
      const once = canonicalTokenValue(decl.type, decl.initial);
      expect([decl.name, once]).not.toEqual([decl.name, undefined]);
      expect([decl.name, canonicalTokenValue(decl.type, once as string)]).toEqual([decl.name, once]);
    }
  });
});

/**
 * The Instance operator's default (#372): the same anchors and the same choke point, from `hexly.yml`
 * instead of a World, and partial because branding a deployment is rarely a whole Theme.
 */
describe('instanceThemeSchema', () => {
  /** The parsed default, or `undefined` when the boot-time check refused it. */
  function parse(input: unknown) {
    const result = instanceThemeSchema.safeParse(input);
    return result.success ? result.data : undefined;
  }

  /** Why the boot-time check refused it, joined — what an operator reads in their terminal. */
  function refusal(input: unknown): string {
    const result = instanceThemeSchema.safeParse(input);
    if (result.success) throw new Error('expected a refusal');
    return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
  }

  it('accepts a single anchor per ColorScheme — an operator branding only their accent', () => {
    const parsed = parse({ version: 2, light: { accent: '#2f6f4f' }, dark: { accent: '#7fd0a8' } });

    expect(parsed?.light?.accent).toMatch(/^oklch\(/);
    expect(parsed?.dark?.accent).toMatch(/^oklch\(/);
    // Everything it is silent about falls through to the stylesheet, so it must not materialise here.
    expect(parsed?.light?.page).toBeUndefined();
  });

  it('accepts the version alone — a block that brands nothing is the shipped default spelled out', () => {
    expect(parse({ version: 2 })).toEqual({ version: 2 });
  });

  it('refuses a value that is not of its token’s type, rather than dropping it', () => {
    // The half-applied default #372 forbids: seven anchors landing and the eighth silently absent.
    expect(refusal({ version: 2, light: { accent: 'url(https://evil.example/p.png)', page: '#f1e5c7' } })).toMatch(
      /light\.accent/,
    );
    expect(parse({ version: 2, light: { accent: 'not-a-colour' } })).toBeUndefined();
    expect(parse({ version: 2, light: { polarity: 'sideways' } })).toBeUndefined();
  });

  it('refuses a misspelled anchor by name, because a dropped one is a default applied half-way', () => {
    expect(refusal({ version: 2, light: { acccent: '#2f6f4f' } })).toMatch(/acccent/);
    expect(refusal({ version: 2, palette: { accent: '#2f6f4f' } })).toMatch(/palette/);
  });

  it('refuses a version it does not know, rather than applying the fields it recognises', () => {
    expect(parse({ version: 3, light: { accent: '#2f6f4f' } })).toBeUndefined();
    expect(refusal({ light: { accent: '#2f6f4f' } })).toMatch(/version/);
  });

  it('carries the radii, the pairing, and the tier-2 opt-outs an Owner may also author', () => {
    const parsed = parse({
      version: 2,
      radii: { '--radius-md': '0px' },
      fontPairing: 'codex',
      overrides: { light: { '--color-ink': '#101010' } },
    });

    expect(parsed?.radii?.['--radius-md']).toBe('0px');
    expect(parsed?.fontPairing).toBe('codex');
    expect(parsed?.overrides?.light?.['--color-ink']).toMatch(/^oklch\(/);
  });

  it('holds an operator to the same contract as an Owner — a token outside it is refused', () => {
    expect(parse({ version: 2, radii: { '--text-base': '1rem' } })).toBeUndefined();
    // A declared token held out of the contract (ADR-0076), so the refusal is the contract talking
    // rather than an unknown name bouncing off the manifest.
    expect(parse({ version: 2, overrides: { light: { '--rail-header': '900px' } } })).toBeUndefined();
    expect(parse({ version: 2, fontPairing: 'comic-sans' })).toBeUndefined();
  });
});

/** The notation a native colour control speaks, against the OKLCH the choke point stores (#371). */
describe('colorTokenHex', () => {
  it('round-trips a stored anchor back to the hex an Owner picked', () => {
    for (const hex of ['#f1e5c7', '#2e2412', '#9a6a16', '#0b0c1a', '#ffffff', '#000000']) {
      expect(colorTokenHex(canonicalTokenValue('color', hex) as string)).toBe(hex);
    }
  });

  it('reads the `rgb()` a browser resolves a registered token to — the editor’s seed', () => {
    expect(colorTokenHex('rgb(11, 12, 26)')).toBe('#0b0c1a');
  });

  it('drops alpha, which a native colour control cannot carry', () => {
    expect(colorTokenHex('oklch(0.5 0.1 40 / 0.5)')).toBe(colorTokenHex('oklch(0.5 0.1 40)'));
  });

  it('answers `undefined` for what is not a colour, rather than a black an Owner never chose', () => {
    expect(colorTokenHex('url(https://evil.example/p.png)')).toBeUndefined();
    expect(colorTokenHex('')).toBeUndefined();
  });

  it('clamps a wide-gamut anchor into sRGB, the only gamut the control has', () => {
    expect(colorTokenHex('oklch(0.7 0.37 145)')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
