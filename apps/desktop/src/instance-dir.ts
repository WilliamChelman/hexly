import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Decides *which* application-support folder {@link pinInstanceDir} sits in, so main must set it before anything
 * reads `userData` and a packaged launch shares the dev launch's Instance (ADR-0070).
 */
export const APP_NAME = 'Hexly';

/**
 * Pin this process's Instance Directory to `<application support>/hexly`, creating it on a first launch. Not
 * user-choosable: a sync daemon or network mount rewriting `hexly.db`/`-wal` under an open WAL handle corrupts
 * the Instance (ADR-0070), and `assets.dir` moves the bulk of the bytes instead (ADR-0034). Stated through
 * `HEXLY_DIR` (ADR-0036), so the API needs no desktop path.
 */
export function pinInstanceDir(applicationSupportDir: string): string {
  const instanceDir = join(applicationSupportDir, 'hexly');
  mkdirSync(instanceDir, { recursive: true });
  process.env.HEXLY_DIR = instanceDir;
  return instanceDir;
}
