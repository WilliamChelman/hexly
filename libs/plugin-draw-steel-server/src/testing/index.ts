/**
 * The Draw Steel server plugin's **testing** entry (`@hexly/plugin-draw-steel/server/testing`): the
 * fixture-backed fetch port that lets a test drive the real `draw-steel.importer.monsters` Importer with no
 * network (ADR-0061). The API's importer controller spec wires this over the boot-time codeload port.
 */

import { MonstersFetchPort } from '../lib/monster-fetch-port';
import { MONSTER_FIXTURES } from './fixtures';

export * from './fixtures';

/**
 * A {@link MonstersFetchPort} that serves committed fixtures instead of fetching — the seam that keeps
 * the whole import pipe offline-testable (ADR-0061). Defaults to the Ajax + Goblin fixtures; pass a
 * custom set to exercise the transform against other shapes.
 */
export function fixtureFetchPort(monsters: readonly unknown[] = MONSTER_FIXTURES): MonstersFetchPort {
  return { fetchMonsters: async () => monsters };
}
