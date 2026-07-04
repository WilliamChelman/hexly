import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parseSize } from './config';

const MB = 1024 * 1024;

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
  it('falls back to defaults when no file is present', () => {
    expect(loadConfig(dataDir())).toEqual({
      import: { maxUpload: 500 * MB, maxDecompressed: 5 * 1024 * MB, strictZipGuard: false },
    });
  });

  it('defaults strictZipGuard off (fast) and lets a file turn it on (airtight)', () => {
    expect(loadConfig(dataDir()).import.strictZipGuard).toBe(false);
    expect(
      loadConfig(dataDir('import:\n  strictZipGuard: true\n')).import.strictZipGuard,
    ).toBe(true);
  });

  it('merges a partial file over defaults, resolving sizes to bytes', () => {
    const cfg = loadConfig(dataDir('import:\n  maxUpload: 20mb\n'));
    expect(cfg.import.maxUpload).toBe(20 * MB);
    expect(cfg.import.maxDecompressed).toBe(5 * 1024 * MB); // untouched default
  });

  it('fails boot on an unparseable size, naming the key', () => {
    expect(() => loadConfig(dataDir('import:\n  maxUpload: 20 potatoes\n'))).toThrow(
      /maxUpload/,
    );
  });

  it('fails boot on a wrong-typed value', () => {
    expect(() => loadConfig(dataDir('import:\n  maxUpload: true\n'))).toThrow();
  });

  it('yields defaults for the :memory: dir without touching disk', () => {
    expect(loadConfig(':memory:')).toEqual({
      import: { maxUpload: 500 * MB, maxDecompressed: 5 * 1024 * MB, strictZipGuard: false },
    });
  });
});
