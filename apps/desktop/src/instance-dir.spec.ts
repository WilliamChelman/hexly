import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pinInstanceDir } from './instance-dir';

describe('the pinned Instance Directory', () => {
  const originalDir = process.env.HEXLY_DIR;
  let applicationSupport: string;

  beforeEach(() => {
    applicationSupport = mkdtempSync(join(tmpdir(), 'hexly-userdata-'));
  });

  afterEach(() => {
    if (originalDir === undefined) delete process.env.HEXLY_DIR;
    else process.env.HEXLY_DIR = originalDir;
    rmSync(applicationSupport, { recursive: true, force: true });
  });

  it('is a `hexly` folder inside the application-support path, created on first launch', () => {
    const instanceDir = pinInstanceDir(applicationSupport);

    expect(instanceDir).toBe(join(applicationSupport, 'hexly'));
    expect(existsSync(instanceDir)).toBe(true);
  });

  it('reuses the folder a previous launch left, keeping its database', () => {
    const first = pinInstanceDir(applicationSupport);

    expect(pinInstanceDir(applicationSupport)).toBe(first);
  });

  it('pins it absolutely where the API reads it, so no cwd is involved', () => {
    const instanceDir = pinInstanceDir(applicationSupport);

    expect(isAbsolute(instanceDir)).toBe(true);
    expect(process.env.HEXLY_DIR).toBe(instanceDir);
  });
});
