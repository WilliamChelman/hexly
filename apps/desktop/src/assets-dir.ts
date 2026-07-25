import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';

/** The Instance Configuration file, beside the database in the Instance Directory (ADR-0036). */
export const CONFIG_FILE = 'hexly.yml';

const ASSETS_DIR_KEY = ['assets', 'dir'] as const;

/**
 * `yamlText` with `assets.dir` set to `dir`, preserving comments, key order and formatting: the file is
 * hand-authored (ADR-0036), so re-serialising a parsed object would delete the operator's own notes. An absent
 * `assets:` block or an absent file is authored from nothing.
 */
export function withAssetsDir(yamlText: string, dir: string): string {
  const config = parseDocument(yamlText);
  config.setIn(ASSETS_DIR_KEY, dir);
  return config.toString();
}

/** Read the Instance Configuration, or `''` — no file is the same input as an empty one to {@link withAssetsDir}. */
export function readConfigFile(instanceDir: string): string {
  try {
    return readFileSync(join(instanceDir, CONFIG_FILE), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Point `assets.dir` at `dir`. Called only once the bytes are copied and verified, since this write is the
 * switch; a failure throws rather than being reported, as an unswitched config with a full new root is not a
 * state to relaunch into.
 */
export function writeAssetsDir(instanceDir: string, dir: string): void {
  writeFileSync(join(instanceDir, CONFIG_FILE), withAssetsDir(readConfigFile(instanceDir), dir));
}
