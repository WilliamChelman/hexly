import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basePluginConfigSchema } from '@hexly/domain';
import { z } from 'zod';
import { loadConfig, parseSize, PluginConfigContribution } from './config';

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
    import: {
      maxUpload: 500 * MB,
      maxDecompressed: 5 * 1024 * MB,
      strictZipGuard: false,
    },
    search: { weights: { name: 10, tags: 5, content: 1 } },
    liveFollow: { heartbeatSeconds: 30 },
    features: { plugin: {} },
    entities: { defaultType: 'core.type.note' },
  };

  it('falls back to defaults when no file is present', () => {
    expect(loadConfig(dataDir())).toEqual(DEFAULTS);
  });

  it('defaults strictZipGuard off (fast) and lets a file turn it on (airtight)', () => {
    expect(loadConfig(dataDir()).import.strictZipGuard).toBe(false);
    expect(loadConfig(dataDir('import:\n  strictZipGuard: true\n')).import.strictZipGuard).toBe(true);
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
