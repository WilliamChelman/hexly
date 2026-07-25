import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { CONFIG_FILE, readConfigFile, withAssetsDir, writeAssetsDir } from './assets-dir';

const CHOSEN = '/Volumes/Big/hexly-assets';

describe('withAssetsDir', () => {
  it('authors the key into a file that has none', () => {
    expect(parse(withAssetsDir('', CHOSEN)).assets.dir).toBe(CHOSEN);
  });

  it('replaces the folder a previous move recorded', () => {
    expect(parse(withAssetsDir('assets:\n  dir: /old/place\n', CHOSEN)).assets.dir).toBe(CHOSEN);
  });

  it("keeps the operator's comments, key order and formatting, which a re-serialised object would delete", () => {
    const before = [
      '# The instance I run for the Thursday game.',
      'features:',
      '  collaboration: false # solo, deliberately',
      '',
      'liveFollow:',
      '  heartbeatSeconds: 45',
      '',
    ].join('\n');

    const after = withAssetsDir(before, CHOSEN);

    expect(after).toContain('# The instance I run for the Thursday game.');
    expect(after).toContain('collaboration: false # solo, deliberately');
    expect(parse(after)).toMatchObject({
      features: { collaboration: false },
      liveFollow: { heartbeatSeconds: 45 },
      assets: { dir: CHOSEN },
    });
  });

  /** A native picker hands back whatever the platform calls a folder; the loader has to read back what we wrote. */
  it.each([
    'C:\\Users\\Ada\\Hexly Assets',
    '/Volumes/My Drive/hexly: assets',
    '/home/ada/#assets',
    '/Users/ada/Assets (backup)',
  ])('quotes a path the parser would otherwise misread: %s', (chosen) => {
    expect(parse(withAssetsDir('# mine\n', chosen)).assets.dir).toBe(chosen);
  });
});

describe('writeAssetsDir', () => {
  let instanceDir: string;

  beforeEach(() => {
    instanceDir = mkdtempSync(join(tmpdir(), 'hexly-instance-'));
  });

  it('records the choice beside the database, where the next boot reads it', () => {
    writeAssetsDir(instanceDir, CHOSEN);

    expect(parse(readFileSync(join(instanceDir, CONFIG_FILE), 'utf8')).assets.dir).toBe(CHOSEN);
  });

  it('rewrites an existing file rather than replacing it', () => {
    writeFileSync(join(instanceDir, CONFIG_FILE), 'features:\n  collaboration: false\n');

    writeAssetsDir(instanceDir, CHOSEN);

    expect(parse(readConfigFile(instanceDir))).toEqual({
      features: { collaboration: false },
      assets: { dir: CHOSEN },
    });
  });
});

describe('readConfigFile', () => {
  it('reads an absent file as empty: an Instance that never needed one still records this choice', () => {
    expect(readConfigFile(join(tmpdir(), 'hexly-nowhere-at-all'))).toBe('');
  });
});
