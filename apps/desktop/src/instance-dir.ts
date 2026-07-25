import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pin this process's Instance Directory to `<application support>/hexly`, creating it on a first launch,
 * and return it. Not user-choosable, and the pin is the safety property: a sync daemon or network mount
 * rewriting `hexly.db`/`-wal` under an open WAL handle corrupts the Instance, so the folder a picker
 * would most often be pointed at is the one that loses Worlds (ADR-0070). `assets.dir` moves the bulk of
 * the bytes instead (ADR-0034).
 *
 * Stated through `HEXLY_DIR` (ADR-0036), the channel every host uses, so the API needs no desktop path.
 */
export function pinInstanceDir(applicationSupportDir: string): string {
  const instanceDir = join(applicationSupportDir, 'hexly');
  mkdirSync(instanceDir, { recursive: true });
  process.env.HEXLY_DIR = instanceDir;
  return instanceDir;
}
