import { DESIGN_TOKENS } from '@hexly/web-styles';
import { canonicalTokenValue, colorTokenHex } from './design-token-value';
import {
  instanceThemeSchema,
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
    return { version: WORLD_THEME_VERSION, solar: palette, astral: { ...palette, polarity: -1 }, ...overrides };
  }

  /** The parsed Theme, or `undefined` when the choke point refused it. */
  function parse(input: unknown) {
    const result = worldThemeSchema.safeParse(input);
    return result.success ? result.data : undefined;
  }

  it('accepts a well-formed Theme and emits every anchor as a colour', () => {
    const parsed = parse(theme());

    expect(parsed?.solar.accent).toMatch(/^oklch\(/);
    expect(parsed?.astral.soot).toMatch(/^oklch\(/);
    expect(parsed?.astral.polarity).toBe(-1);
  });

  it('refuses a `url()` anchor — the value abuse the boundary exists for (ADR-0076)', () => {
    expect(parse(theme({ solar: { ...theme().solar, accent: 'url(https://evil.example/p.png)' } }))).toBeUndefined();
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
    expect(parse(theme({ solar: { ...theme().solar, accent: value } }))).toBeUndefined();
  });

  it('refuses an anchor that is not a string at all', () => {
    expect(parse(theme({ solar: { ...theme().solar, accent: 0xff0000 as unknown as string } }))).toBeUndefined();
  });

  it('refuses an unknown `version` rather than applying the part it understands', () => {
    expect(parse({ ...theme(), version: 2 })).toBeUndefined();
    expect(parse({ ...theme(), version: undefined })).toBeUndefined();
  });

  it('canonicalises to one form, so the notation an Owner sends stops mattering', () => {
    const red = ['red', '#ff0000', 'rgb(255 0 0)', 'rgb(255, 0, 0)', 'hsl(0 100% 50%)'].map(
      (notation) => parse(theme({ solar: { ...theme().solar, accent: notation } }))?.solar.accent,
    );

    expect(new Set(red).size).toBe(1);
    expect(red[0]).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
  });

  it('keeps alpha, because the translucent roles are half the contract', () => {
    expect(parse(theme({ solar: { ...theme().solar, soot: 'rgba(60, 44, 22, 0.42)' } }))?.solar.soot).toMatch(
      / \/ 0\.42\)$/,
    );
  });

  it('refuses a knob outside the range its role has', () => {
    expect(parse(theme({ solar: { ...theme().solar, veil: 1.4 } }))).toBeUndefined();
    expect(parse(theme({ solar: { ...theme().solar, lineAlpha: -0.1 } }))).toBeUndefined();
    expect(parse(theme({ solar: { ...theme().solar, polarity: Number.NaN } }))).toBeUndefined();
  });

  describe('overrides', () => {
    const withOverride = (name: string, value: unknown) =>
      parse({ ...theme(), overrides: { solar: { [name]: value } } });

    it('accepts a public role token and canonicalises its value', () => {
      expect(withOverride('--color-ink-muted', '#6f5a36')?.overrides?.solar?.['--color-ink-muted']).toMatch(/^oklch\(/);
    });

    it.each([
      ['an undeclared token', '--color-nope', '#fff'],
      ['a token out of the contract', '--text-base', '2rem'],
      ["another plugin's vocabulary", '--color-terrain-grass', '#fff'],
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
        withOverride('--shadow-2', 'inset 0 1px 2px rgba(60, 44, 22, 0.12)')?.overrides?.solar?.['--shadow-2'],
      ).toMatch(/^inset 0 1px 2px oklch\(/);
    });

    it('keeps the two ColorSchemes apart', () => {
      const parsed = parse({ ...theme(), overrides: { astral: { '--color-ink': '#fff' } } });
      expect(parsed?.overrides?.astral?.['--color-ink']).toMatch(/^oklch\(/);
      expect(parsed?.overrides?.solar).toBeUndefined();
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
  });

  it('maps every stored Palette field onto exactly the manifest’s tier-1 tokens', () => {
    // The applier reads this table, so both of its ends answer to their own source: the field names to
    // the stored schema, the token names to the manifest's Palette tier (ADR-0075).
    const stored = Object.keys(worldThemeSchema.shape.solar.shape);
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
    const parsed = parse({ version: 1, solar: { accent: '#2f6f4f' }, astral: { accent: '#7fd0a8' } });

    expect(parsed?.solar?.accent).toMatch(/^oklch\(/);
    expect(parsed?.astral?.accent).toMatch(/^oklch\(/);
    // Everything it is silent about falls through to the stylesheet, so it must not materialise here.
    expect(parsed?.solar?.page).toBeUndefined();
  });

  it('accepts the version alone — a block that brands nothing is the shipped default spelled out', () => {
    expect(parse({ version: 1 })).toEqual({ version: 1 });
  });

  it('refuses a value that is not of its token’s type, rather than dropping it', () => {
    // The half-applied default #372 forbids: seven anchors landing and the eighth silently absent.
    expect(refusal({ version: 1, solar: { accent: 'url(https://evil.example/p.png)', page: '#f1e5c7' } })).toMatch(
      /solar\.accent/,
    );
    expect(parse({ version: 1, solar: { accent: 'not-a-colour' } })).toBeUndefined();
    expect(parse({ version: 1, solar: { polarity: 'sideways' } })).toBeUndefined();
  });

  it('refuses a misspelled anchor by name, because a dropped one is a default applied half-way', () => {
    expect(refusal({ version: 1, solar: { acccent: '#2f6f4f' } })).toMatch(/acccent/);
    expect(refusal({ version: 1, palette: { accent: '#2f6f4f' } })).toMatch(/palette/);
  });

  it('refuses a version it does not know, rather than applying the fields it recognises', () => {
    expect(parse({ version: 2, solar: { accent: '#2f6f4f' } })).toBeUndefined();
    expect(refusal({ solar: { accent: '#2f6f4f' } })).toMatch(/version/);
  });

  it('carries the radii, the pairing, and the tier-2 opt-outs an Owner may also author', () => {
    const parsed = parse({
      version: 1,
      radii: { '--radius-md': '0px' },
      fontPairing: 'codex',
      overrides: { solar: { '--color-ink': '#101010' } },
    });

    expect(parsed?.radii?.['--radius-md']).toBe('0px');
    expect(parsed?.fontPairing).toBe('codex');
    expect(parsed?.overrides?.solar?.['--color-ink']).toMatch(/^oklch\(/);
  });

  it('holds an operator to the same contract as an Owner — a token outside it is refused', () => {
    expect(parse({ version: 1, radii: { '--text-base': '1rem' } })).toBeUndefined();
    expect(parse({ version: 1, overrides: { solar: { '--rail-inspector': '900px' } } })).toBeUndefined();
    expect(parse({ version: 1, fontPairing: 'comic-sans' })).toBeUndefined();
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
