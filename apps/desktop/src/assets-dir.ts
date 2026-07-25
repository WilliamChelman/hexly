import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';

/**
 * The one write this app makes to `hexly.yml`. Config is read once at boot (ADR-0036), so pointing
 * `assets.dir` (#324) at the folder the bytes were just copied to is the last step of the move — and the
 * reason the app then relaunches itself (ADR-0070).
 */

/** The Instance Configuration file, beside the database in the Instance Directory (ADR-0036). */
export const CONFIG_FILE = 'hexly.yml';

/** The key #324 reads the Assets root from. Restated rather than imported: the loader owns reading it. */
const ASSETS_DIR_KEY = ['assets', 'dir'] as const;

/**
 * `yamlText` with `assets.dir` set to `dir`, leaving everything else — including the operator's comments,
 * key order and formatting — as it was. This file is hand-authored (ADR-0036), so re-serialising a parsed
 * object would answer a folder change by silently deleting the notes someone left themselves.
 *
 * An absent `assets:` block is created, and an absent file is one this rewrite authors from nothing: a
 * Desktop App that has never needed a config still has to be able to record this choice.
 */
export function withAssetsDir(yamlText: string, dir: string): string {
  const config = parseDocument(yamlText);
  // Absolute, always. The user picked this folder in a native dialog, where nothing was relative to the
  // Instance Directory; `resolveAssetsDir` accepts either, and the unambiguous one is what we write.
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
 * Point `assets.dir` at `dir`. Called only once the bytes are copied and verified: this write is the switch,
 * and a failure here throws rather than being reported — an unswitched config with a full new root is a
 * state the user has to be told about, not one to relaunch into.
 */
export function writeAssetsDir(instanceDir: string, dir: string): void {
  writeFileSync(join(instanceDir, CONFIG_FILE), withAssetsDir(readConfigFile(instanceDir), dir));
}
