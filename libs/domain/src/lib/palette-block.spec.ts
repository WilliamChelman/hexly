import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESIGN_TOKENS, GENERATE_COMMAND } from '@hexly/web-styles';
import {
  TOKENS_STYLESHEET_PATH,
  palettePresetRegion,
  palettePresetRegionIn,
  withPalettePresetRegions,
} from './palette-block';
import {
  DEFAULT_PALETTE_PRESETS,
  PALETTE_PRESETS,
  PALETTE_PRESET_IDS,
  WORLD_THEME_SCHEME_KEYS,
} from './palette-preset';
import { OVERRIDABLE_TOKENS, PALETTE_TOKENS, WORLD_THEME_VERSION, worldThemeSchema } from './world-theme';

const repoRoot = new URL('../../../../', import.meta.url);
const committed = readFileSync(fileURLToPath(new URL(TOKENS_STYLESHEET_PATH, repoRoot)), 'utf8');

/** The custom properties a slice of CSS declares, in source order. Comments carry prose, not values. */
function declarationsIn(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]);
}

describe('the tier-1 regions of tokens.css', () => {
  it('are what the committed stylesheet holds', () => {
    expect(
      withPalettePresetRegions(committed),
      `the tier-1 regions are generated from PALETTE_PRESETS — run \`${GENERATE_COMMAND}\``,
    ).toBe(committed);
  });

  it('write every tier-1 token the manifest declares, in the order it declares them', () => {
    for (const scheme of WORLD_THEME_SCHEME_KEYS) {
      const region = palettePresetRegionIn(committed, scheme);
      const anchors = declarationsIn(region).filter((name) => name.startsWith('--palette-'));
      expect(anchors, scheme).toEqual(Object.values(PALETTE_TOKENS));
    }
  });

  it("carries Astral's canvas glow as the Preset's own override rather than beside the block", () => {
    // The stylesheet keys off `[data-color-scheme]` and a stored Theme holds no Preset id, so
    // `overrides` is the only mechanism that can carry a per-Preset named literal (ADR-0077).
    const glow = '--color-canvas-glow';
    expect(PALETTE_PRESETS.astral.overrides?.[glow]).toBeDefined();
    expect(declarationsIn(palettePresetRegionIn(committed, 'astral'))).toContain(glow);
    // Once in the whole sheet, so nothing outside the region restates it.
    expect(declarationsIn(committed).filter((name) => name === glow)).toHaveLength(1);
  });

  it('leave the motion, elevation, layout-rail and sheen tokens the Solar block shares alone', () => {
    // `@theme` cannot hold these (ADR-0020), which is why they sit in the same block as tier 1 — and
    // why the generator writes a region and not the block.
    const shared = ['--dur-fast', '--ease-out', '--rail-header', '--shadow-2', '--gradient-accent-sheen'];
    const regions = WORLD_THEME_SCHEME_KEYS.map((scheme) => palettePresetRegionIn(committed, scheme)).join('\n');
    for (const name of shared) {
      expect(declarationsIn(committed), name).toContain(name);
      expect(declarationsIn(regions), name).not.toContain(name);
    }
  });

  it('splice under whatever indentation the stylesheet gave the fence', () => {
    // The fence's own indentation is read back rather than assumed, as the pre-paint allowlist's is.
    for (const line of palettePresetRegion('solar', '    ').split('\n')) {
      if (line !== '') expect(line).toMatch(/^ {4}\S/);
    }
  });

  it('refuse a stylesheet with no fence to splice into, rather than writing nothing', () => {
    expect(() => withPalettePresetRegions('/* no fences here */')).toThrow(/tokens\.css is missing/);
  });
});

describe('PALETTE_PRESETS', () => {
  it('keys every entry by its own id, and gives each ColorScheme a default', () => {
    for (const id of PALETTE_PRESET_IDS) expect(PALETTE_PRESETS[id].id).toBe(id);
    for (const scheme of WORLD_THEME_SCHEME_KEYS) {
      expect(PALETTE_PRESETS[DEFAULT_PALETTE_PRESETS[scheme]].scheme).toBe(scheme);
    }
  });

  it("carries exactly the stored Palette's field set, so a pick fills in every control", () => {
    for (const id of PALETTE_PRESET_IDS) {
      expect(Object.keys(PALETTE_PRESETS[id].values).sort(), id).toEqual(Object.keys(PALETTE_TOKENS).sort());
    }
  });

  it('overrides only tokens a World Theme may override', () => {
    const overridable = OVERRIDABLE_TOKENS.map((decl) => decl.name);
    for (const id of PALETTE_PRESET_IDS) {
      for (const name of Object.keys(PALETTE_PRESETS[id].overrides ?? {})) expect(overridable, id).toContain(name);
    }
  });

  it('clears the write choke point, since applying one writes a Theme an Owner then saves', () => {
    for (const id of PALETTE_PRESET_IDS) {
      const preset = PALETTE_PRESETS[id];
      const parsed = worldThemeSchema.safeParse({
        version: WORLD_THEME_VERSION,
        solar: preset.values,
        astral: preset.values,
        overrides: { [preset.scheme]: preset.overrides ?? {} },
      });
      expect(parsed.success, `${id}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it("restates the manifest's tier-1 initial values, which are the default light Preset's", () => {
    // `@property` registers one initial-value per token and it is Solar's (ADR-0075). The manifest
    // cannot read this table — `web-styles` sits under `libs/domain`, not above it — so the drift the
    // generated stylesheet can no longer have is refused here instead.
    const light = PALETTE_PRESETS[DEFAULT_PALETTE_PRESETS.solar].values;
    const field = Object.fromEntries(Object.entries(PALETTE_TOKENS).map(([name, token]) => [token, name]));
    for (const decl of DESIGN_TOKENS.filter((token) => token.tier === 'palette')) {
      expect(String(light[field[decl.name] as keyof typeof light]), decl.name).toBe(decl.initial);
    }
  });

  it('names the ColorSchemes the stored Theme keys its overrides by', () => {
    expect([...WORLD_THEME_SCHEME_KEYS].sort()).toEqual(
      Object.keys(worldThemeSchema.shape.overrides.unwrap().shape).sort(),
    );
  });
});
