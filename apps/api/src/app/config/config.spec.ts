import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basePluginConfigSchema } from '@hexly/domain';
import * as z from 'zod';
import { deploymentPins, loadConfig, parseSize, pinDeployment, PluginConfigContribution } from './config';

const MB = 1024 * 1024;

/**
 * A stand-in for the bundled Plugin set (ADR-0052): three ids, one of which (`dnd`) extends the base
 * config with its own knob, so the "composed schema accepts a Plugin's own fields" path is exercised
 * without a real Plugin having to grow a knob.
 */
const PLUGINS: readonly PluginConfigContribution[] = [
  { id: 'content', configSchema: basePluginConfigSchema },
  { id: 'hexmap', configSchema: basePluginConfigSchema },
  { id: 'dnd', configSchema: basePluginConfigSchema.extend({ maxCr: z.number().default(30) }) },
];

/** A throwaway data dir, optionally seeded with a `hexly.yml`. */
function dataDir(yml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hexly-cfg-'));
  if (yml !== undefined) writeFileSync(join(dir, 'hexly.yml'), yml);
  return dir;
}

describe('parseSize', () => {
  it('parses "100mb" to bytes', () => {
    expect(parseSize('100mb')).toBe(100 * 1024 * 1024);
  });

  it('handles each unit, case-insensitively', () => {
    expect(parseSize('512b')).toBe(512);
    expect(parseSize('2KB')).toBe(2 * 1024);
    expect(parseSize('1Gb')).toBe(1024 * 1024 * 1024);
  });

  it('accepts decimals and surrounding/inner whitespace', () => {
    expect(parseSize('1.5gb')).toBe(1.5 * 1024 * 1024 * 1024);
    expect(parseSize('  100 mb ')).toBe(100 * 1024 * 1024);
  });

  it('throws on a missing unit, unknown unit, or garbage', () => {
    expect(() => parseSize('100')).toThrow();
    expect(() => parseSize('100tb')).toThrow();
    expect(() => parseSize('abc')).toThrow();
  });
});

describe('loadConfig', () => {
  const DEFAULTS = {
    profile: 'server',
    import: {
      maxUpload: 500 * MB,
      maxDecompressed: 5 * 1024 * MB,
      strictZipGuard: false,
      maxCreatedEntities: 5_000,
    },
    search: { weights: { name: 10, tags: 5, content: 1 } },
    liveFollow: { heartbeatSeconds: 30 },
    features: { plugin: {}, collaboration: true },
    entities: { defaultType: 'core.type.note', inlineType: 'core.type.note' },
    // No `assets.dir`: absent stays absent, and the assets seam supplies the default root.
    assets: {},
  };

  it('falls back to defaults when no file is present', () => {
    expect(loadConfig(dataDir())).toEqual(DEFAULTS);
  });

  it('defaults strictZipGuard off (fast) and lets a file turn it on (airtight)', () => {
    expect(loadConfig(dataDir()).import.strictZipGuard).toBe(false);
    expect(loadConfig(dataDir('import:\n  strictZipGuard: true\n')).import.strictZipGuard).toBe(true);
  });

  it('takes a maxCreatedEntities ceiling from the file, and refuses a nonsensical one', () => {
    // The bound on what one import may mint for unresolved wikilinks (ADR-0073) — an operator raises
    // it for a genuinely huge vault; zero or a fraction would only ever be a mistake.
    expect(loadConfig(dataDir('import:\n  maxCreatedEntities: 25\n')).import.maxCreatedEntities).toBe(25);
    expect(() => loadConfig(dataDir('import:\n  maxCreatedEntities: 0\n'))).toThrow(/maxCreatedEntities/);
    expect(() => loadConfig(dataDir('import:\n  maxCreatedEntities: 1.5\n'))).toThrow(/maxCreatedEntities/);
  });

  it('merges a partial file over defaults, resolving sizes to bytes', () => {
    const cfg = loadConfig(dataDir('import:\n  maxUpload: 20mb\n'));
    expect(cfg.import.maxUpload).toBe(20 * MB);
    expect(cfg.import.maxDecompressed).toBe(5 * 1024 * MB); // untouched default
  });

  it('fails boot on an unparseable size, naming the key', () => {
    expect(() => loadConfig(dataDir('import:\n  maxUpload: 20 potatoes\n'))).toThrow(/maxUpload/);
  });

  it('fails boot on a wrong-typed value', () => {
    expect(() => loadConfig(dataDir('import:\n  maxUpload: true\n'))).toThrow();
  });

  it('yields defaults for the :memory: dir without touching disk', () => {
    expect(loadConfig(':memory:')).toEqual(DEFAULTS);
  });

  it('overrides a single search weight, leaving the others at their default', () => {
    const cfg = loadConfig(dataDir('search:\n  weights:\n    name: 20\n'));
    expect(cfg.search.weights).toEqual({ name: 20, tags: 5, content: 1 });
  });

  it('rejects a non-positive search weight, naming the key', () => {
    expect(() => loadConfig(dataDir('search:\n  weights:\n    name: 0\n'))).toThrow(/name/);
  });

  it('overrides the live-follow heartbeat cadence from the file', () => {
    const cfg = loadConfig(dataDir('liveFollow:\n  heartbeatSeconds: 10\n'));
    expect(cfg.liveFollow.heartbeatSeconds).toBe(10);
  });

  it('rejects a non-positive heartbeat cadence, naming the key', () => {
    expect(() => loadConfig(dataDir('liveFollow:\n  heartbeatSeconds: 0\n'))).toThrow(/heartbeatSeconds/);
  });
});

describe('loadConfig: features.plugin (ADR-0052)', () => {
  it('resolves every bundled Plugin enabled when the file names none', () => {
    const plugin = loadConfig(dataDir(), PLUGINS).features.plugin;
    expect(plugin.content.enabled).toBe(true);
    expect(plugin.hexmap.enabled).toBe(true);
    expect(plugin.dnd.enabled).toBe(true);
  });

  it('yields all-enabled defaults for the :memory: Instance', () => {
    const plugin = loadConfig(':memory:', PLUGINS).features.plugin;
    expect(plugin.content.enabled).toBe(true);
    expect(plugin.hexmap.enabled).toBe(true);
    expect(plugin.dnd.enabled).toBe(true);
  });

  it('resolves a Plugin disabled when the file sets enabled: false, leaving the others enabled', () => {
    const plugin = loadConfig(dataDir('features:\n  plugin:\n    dnd:\n      enabled: false\n'), PLUGINS).features
      .plugin;
    expect(plugin.dnd.enabled).toBe(false);
    expect(plugin.content.enabled).toBe(true);
    expect(plugin.hexmap.enabled).toBe(true);
  });

  it('disables content like any other Plugin — no privileged Plugin', () => {
    const plugin = loadConfig(dataDir('features:\n  plugin:\n    content:\n      enabled: false\n'), PLUGINS).features
      .plugin;
    expect(plugin.content.enabled).toBe(false);
    expect(plugin.hexmap.enabled).toBe(true);
  });

  it("accepts a Plugin's own config fields, defaulting them when absent", () => {
    expect(loadConfig(dataDir(), PLUGINS).features.plugin.dnd).toEqual({ enabled: true, maxCr: 30 });
    const set = loadConfig(dataDir('features:\n  plugin:\n    dnd:\n      maxCr: 5\n'), PLUGINS).features.plugin;
    expect(set.dnd).toEqual({ enabled: true, maxCr: 5 });
  });

  it('strips an unknown Plugin id without throwing or affecting known Plugins', () => {
    const plugin = loadConfig(dataDir('features:\n  plugin:\n    hexmpa:\n      enabled: false\n'), PLUGINS).features
      .plugin;
    expect(plugin).not.toHaveProperty('hexmpa');
    expect(plugin.hexmap.enabled).toBe(true);
    expect(plugin.dnd.enabled).toBe(true);
  });

  it("strips an unknown sub-key, leaving the Plugin's known knobs intact", () => {
    const plugin = loadConfig(dataDir('features:\n  plugin:\n    dnd:\n      wat: true\n'), PLUGINS).features.plugin;
    expect(plugin.dnd).toEqual({ enabled: true, maxCr: 30 });
  });

  it('fails boot on an invalid enabled value, naming the key', () => {
    expect(() => loadConfig(dataDir('features:\n  plugin:\n    dnd:\n      enabled: "maybe"\n'), PLUGINS)).toThrow(
      /enabled/,
    );
  });
});

describe('loadConfig: features.collaboration (ADR-0071)', () => {
  it('defaults on, so an existing Instance upgrades with no change to its file', () => {
    expect(loadConfig(dataDir(), PLUGINS).features.collaboration).toBe(true);
    expect(loadConfig(':memory:', PLUGINS).features.collaboration).toBe(true);
    expect(
      loadConfig(dataDir('features:\n  plugin:\n    dnd:\n      enabled: false\n'), PLUGINS).features.collaboration,
    ).toBe(true);
  });

  it('turns off from the file, beside features.plugin', () => {
    const cfg = loadConfig(
      dataDir('features:\n  collaboration: false\n  plugin:\n    dnd:\n      enabled: false\n'),
      PLUGINS,
    );
    expect(cfg.features.collaboration).toBe(false);
    expect(cfg.features.plugin.dnd.enabled).toBe(false);
  });

  it('fails boot on a non-boolean value, naming the key', () => {
    expect(() => loadConfig(dataDir('features:\n  collaboration: maybe\n'), PLUGINS)).toThrow(/collaboration/);
  });

  it('lets an entry-point pin win over the file, in both directions', () => {
    // The Desktop App pins it off and ignores the key entirely (ADR-0071).
    expect(
      loadConfig(dataDir('features:\n  collaboration: true\n'), PLUGINS, { collaboration: false }).features
        .collaboration,
    ).toBe(false);
    expect(
      loadConfig(dataDir('features:\n  collaboration: false\n'), PLUGINS, { collaboration: true }).features
        .collaboration,
    ).toBe(true);
  });

  it('leaves the file in charge when the entry point pins nothing', () => {
    expect(
      loadConfig(dataDir('features:\n  collaboration: false\n'), PLUGINS, { profile: 'server' }).features.collaboration,
    ).toBe(false);
  });
});

describe('loadConfig: profile (ADR-0071)', () => {
  it('defaults to the server profile when the entry point pins none', () => {
    expect(loadConfig(dataDir(), PLUGINS).profile).toBe('server');
  });

  it('resolves whichever profile the entry point pins', () => {
    expect(loadConfig(dataDir(), PLUGINS, { profile: 'desktop' }).profile).toBe('desktop');
    expect(loadConfig(dataDir(), PLUGINS, { profile: 'server' }).profile).toBe('server');
  });

  it('ignores a profile: key written into hexly.yml, rather than honouring it', () => {
    // No config key for the profile, so the key is stripped like any unknown one (ADR-0071).
    expect(loadConfig(dataDir('profile: desktop\n'), PLUGINS).profile).toBe('server');
    expect(loadConfig(dataDir('profile: server\n'), PLUGINS, { profile: 'desktop' }).profile).toBe('desktop');
  });
});

describe('deployment pins (ADR-0071)', () => {
  // Module state: a spec that left a pin behind would hand its deployment to every later one.
  afterEach(() => pinDeployment({}));

  it('reads back what the entry point pinned, so ConfigModule can hand it to loadConfig', () => {
    pinDeployment({ profile: 'desktop', collaboration: false });

    expect(loadConfig(dataDir(), PLUGINS, deploymentPins())).toMatchObject({
      profile: 'desktop',
      features: { collaboration: false },
    });
  });

  it('starts unpinned, which is the server profile with the file in charge of Collaboration', () => {
    expect(deploymentPins()).toEqual({});
    expect(loadConfig(dataDir('features:\n  collaboration: false\n'), PLUGINS, deploymentPins())).toMatchObject({
      profile: 'server',
      features: { collaboration: false },
    });
  });
});

describe('loadConfig: assets.dir (ADR-0034, ADR-0070)', () => {
  it('is absent by default, so an existing Instance keeps its `assets` folder with no migration', () => {
    expect(loadConfig(dataDir(), PLUGINS).assets.dir).toBeUndefined();
    expect(loadConfig(':memory:', PLUGINS).assets.dir).toBeUndefined();
  });

  it('loads an absolute path — Asset bytes on an external drive, the database left where it is', () => {
    expect(loadConfig(dataDir('assets:\n  dir: /Volumes/Vault/hexly-assets\n'), PLUGINS).assets.dir).toBe(
      '/Volumes/Vault/hexly-assets',
    );
  });

  it('loads a relative path verbatim, for the assets seam to resolve against the Instance Directory', () => {
    expect(loadConfig(dataDir('assets:\n  dir: ../shared/assets\n'), PLUGINS).assets.dir).toBe('../shared/assets');
  });

  it('fails boot on an empty or wrong-typed value, naming the key', () => {
    expect(() => loadConfig(dataDir('assets:\n  dir: ""\n'), PLUGINS)).toThrow(/dir/);
    expect(() => loadConfig(dataDir('assets:\n  dir: true\n'), PLUGINS)).toThrow(/dir/);
  });
});

describe('loadConfig: entities.defaultType (ADR-0052)', () => {
  it('defaults to core.type.note when absent', () => {
    expect(loadConfig(dataDir(), PLUGINS).entities.defaultType).toBe('core.type.note');
    expect(loadConfig(':memory:', PLUGINS).entities.defaultType).toBe('core.type.note');
  });

  it('resolves a present value verbatim, with no validation against the enabled set', () => {
    // `nope.type.unknown` names no bundled Plugin's Type — this knob never fails boot (soft client-side fallback).
    expect(loadConfig(dataDir('entities:\n  defaultType: nope.type.unknown\n'), PLUGINS).entities.defaultType).toBe(
      'nope.type.unknown',
    );
  });
});

describe('loadConfig: the Inline Creation knobs (ADR-0073)', () => {
  it('defaults inlineType to core.type.note when absent', () => {
    expect(loadConfig(dataDir(), PLUGINS).entities.inlineType).toBe('core.type.note');
    expect(loadConfig(':memory:', PLUGINS).entities.inlineType).toBe('core.type.note');
  });

  it('resolves a present inlineType verbatim, separately from defaultType', () => {
    const config = loadConfig(dataDir('entities:\n  defaultType: core.type.hex-map\n'), PLUGINS);

    expect(config.entities.defaultType).toBe('core.type.hex-map');
    expect(config.entities.inlineType).toBe('core.type.note');
  });

  it('resolves inlineType with no validation against the Type registry, like defaultType beside it', () => {
    // A nonsense id degrades at the point of use; this knob never fails boot (ADR-0073).
    expect(loadConfig(dataDir('entities:\n  inlineType: nope.type.unknown\n'), PLUGINS).entities.inlineType).toBe(
      'nope.type.unknown',
    );
  });

  it('rejects a non-string inlineType, naming the key', () => {
    expect(() => loadConfig(dataDir('entities:\n  inlineType: 42\n'), PLUGINS)).toThrow(/inlineType/);
    expect(() => loadConfig(dataDir('entities:\n  inlineType: true\n'), PLUGINS)).toThrow(/inlineType/);
  });

  it('leaves inlineTag absent — not empty — when unset, so nothing is imposed on authors', () => {
    expect(loadConfig(dataDir(), PLUGINS).entities.inlineTag).toBeUndefined();
    expect(loadConfig(':memory:', PLUGINS).entities.inlineTag).toBeUndefined();
    expect(
      loadConfig(dataDir('entities:\n  defaultType: core.type.note\n'), PLUGINS).entities.inlineTag,
    ).toBeUndefined();
  });

  it('resolves a present inlineTag verbatim', () => {
    expect(loadConfig(dataDir('entities:\n  inlineTag: untriaged\n'), PLUGINS).entities.inlineTag).toBe('untriaged');
  });

  it('fails boot on an empty or wrong-typed inlineTag, naming the key', () => {
    expect(() => loadConfig(dataDir('entities:\n  inlineTag: ""\n'), PLUGINS)).toThrow(/inlineTag/);
    expect(() => loadConfig(dataDir('entities:\n  inlineTag: 7\n'), PLUGINS)).toThrow(/inlineTag/);
  });
});

describe('loadConfig: the Instance default Theme (ADR-0076, #372)', () => {
  /** An operator branding only their accent — the smallest useful default (#372). */
  const ACCENT_YAML = "theme:\n  version: 2\n  light:\n    accent: '#2f6f4f'\n  dark:\n    accent: '#7fd0a8'\n";

  it('ships empty, so an untouched deployment carries no layer at all', () => {
    expect(loadConfig(dataDir(), PLUGINS).theme).toBeUndefined();
    expect(loadConfig(':memory:', PLUGINS).theme).toBeUndefined();
  });

  it('loads a partial default, canonicalising each value through the World Theme choke point', () => {
    const theme = loadConfig(dataDir(ACCENT_YAML), PLUGINS).theme;

    expect(theme?.light?.accent).toMatch(/^oklch\(/);
    expect(theme?.dark?.accent).toMatch(/^oklch\(/);
    // Silent about everything else, which is what lets the stylesheet answer for the rest.
    expect(theme?.light?.page).toBeUndefined();
  });

  it('fails boot on a malformed value, naming the anchor rather than applying the rest', () => {
    // The acceptance criterion #372 is built around: a half-applied operator default is not a state
    // the Instance is allowed to reach.
    const yaml = "theme:\n  version: 2\n  light:\n    page: '#f1e5c7'\n    accent: 'url(https://evil.example/p.png)'\n";

    expect(() => loadConfig(dataDir(yaml), PLUGINS)).toThrow(/theme\.light\.accent/);
  });

  it('fails boot on a misspelled key, which would otherwise brand nothing and say nothing', () => {
    expect(() => loadConfig(dataDir("theme:\n  version: 2\n  light:\n    acccent: '#2f6f4f'\n"), PLUGINS)).toThrow(
      /acccent/,
    );
  });

  it('fails boot on a version this build does not know', () => {
    expect(() => loadConfig(dataDir('theme:\n  version: 9\n'), PLUGINS)).toThrow(/theme\.version/);
    expect(() => loadConfig(dataDir("theme:\n  light:\n    accent: '#2f6f4f'\n"), PLUGINS)).toThrow(/theme\.version/);
  });

  it('reports every offending key at once, so one boot names the whole list', () => {
    const yaml = "theme:\n  version: 2\n  light:\n    accent: 'nope'\n  dark:\n    ink: 'also-nope'\n";

    expect(() => loadConfig(dataDir(yaml), PLUGINS)).toThrow(/theme\.light\.accent[\s\S]*theme\.dark\.ink/);
  });

  it("loads the README's worked example — every field of the block, exactly as documented", () => {
    // Documentation that would not boot is worse than none, so the README's example is a fixture.
    // Ahead of it for the moment: the README still spells the pre-ADR-0077 keys and catches up in #387.
    const readme = [
      'theme:',
      '  version: 2',
      '  light:',
      "    page: '#f4ece0'",
      "    ink: '#20242e'",
      "    inkQuiet: '#5c6472'",
      "    accent: '#2f6f4f'",
      "    danger: '#a4402e'",
      "    success: '#4a6f2f'",
      "    canvas: '#efe7db'",
      "    soot: '#2a2f38'",
      '    polarity: 1',
      '    lineAlpha: 0.371',
      '    veil: 0.12',
      '  dark:',
      "    accent: '#7ad3a4'",
      '  radii:',
      '    --radius-md: 0px',
      '  fontPairing: codex',
      '  overrides:',
      '    light:',
      "      --color-ink: '#101010'",
      '',
    ].join('\n');

    const theme = loadConfig(dataDir(readme), PLUGINS).theme;

    expect(theme?.light?.polarity).toBe(1);
    expect(theme?.dark?.accent).toMatch(/^oklch\(/);
    expect(theme?.fontPairing).toBe('codex');
  });

  it('carries the radii and the tier-2 opt-outs an Owner may also author', () => {
    const yaml =
      "theme:\n  version: 2\n  radii:\n    --radius-md: 0px\n  overrides:\n    light:\n      --color-ink: '#101010'\n";
    const theme = loadConfig(dataDir(yaml), PLUGINS).theme;

    expect(theme?.radii?.['--radius-md']).toBe('0px');
    expect(theme?.overrides?.light?.['--color-ink']).toMatch(/^oklch\(/);
  });
});
